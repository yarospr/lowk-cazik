type DatabaseRow = Record<string, any>;

type LocalDatabaseState = {
  players: DatabaseRow[];
  market_offers: DatabaseRow[];
};

type TableName = keyof LocalDatabaseState;
type QueryOperation = 'select' | 'insert' | 'update';
type QueryResult = { data: any; error: { message: string; code?: string } | null };

const STORAGE_KEY = 'lowk_cazik_local_database_v1';

const emptyState = (): LocalDatabaseState => ({
  players: [],
  market_offers: [],
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const readState = (): LocalDatabaseState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();

    const parsed = JSON.parse(raw) as Partial<LocalDatabaseState>;
    return {
      players: Array.isArray(parsed.players) ? parsed.players : [],
      market_offers: Array.isArray(parsed.market_offers) ? parsed.market_offers : [],
    };
  } catch {
    return emptyState();
  }
};

const writeState = (state: LocalDatabaseState) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

const primaryKeyFor = (table: TableName) => table === 'players' ? 'telegram_id' : 'offer_id';

class LocalQueryBuilder implements PromiseLike<QueryResult> {
  private operation: QueryOperation = 'select';
  private payload: DatabaseRow | DatabaseRow[] | null = null;
  private filters: Array<(row: DatabaseRow) => boolean> = [];
  private selectedColumns = '*';
  private returnRows = false;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private rowLimit: number | null = null;

  constructor(private readonly table: TableName) {}

  select(columns = '*') {
    this.selectedColumns = columns;
    if (this.operation !== 'select') this.returnRows = true;
    return this;
  }

  insert(payload: DatabaseRow | DatabaseRow[]) {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: DatabaseRow) {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push(row => row[column] === value);
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push(row => row[column] !== value);
    return this;
  }

  in(column: string, values: unknown[]) {
    const accepted = new Set(values);
    this.filters.push(row => accepted.has(row[column]));
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.orderBy = { column, ascending: options.ascending !== false };
    return this;
  }

  limit(value: number) {
    this.rowLimit = Math.max(0, Math.floor(value));
    return this;
  }

  single() {
    return this.execute('single');
  }

  maybeSingle() {
    return this.execute('maybeSingle');
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private matches(row: DatabaseRow) {
    return this.filters.every(filter => filter(row));
  }

  private project(row: DatabaseRow) {
    if (this.selectedColumns.trim() === '*') return clone(row);

    const result: DatabaseRow = {};
    for (const column of this.selectedColumns.split(',').map(value => value.trim()).filter(Boolean)) {
      result[column] = row[column];
    }
    return clone(result);
  }

  private async execute(mode: 'many' | 'single' | 'maybeSingle' = 'many'): Promise<QueryResult> {
    try {
      const state = readState();
      const tableRows = state[this.table];
      let resultRows: DatabaseRow[] = [];

      if (this.operation === 'select') {
        resultRows = tableRows.filter(row => this.matches(row));
      }

      if (this.operation === 'insert') {
        const now = new Date().toISOString();
        const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload])
          .filter(Boolean)
          .map(row => ({ created_at: now, updated_at: now, ...clone(row as DatabaseRow) }));
        const primaryKey = primaryKeyFor(this.table);
        const duplicate = incoming.find(row => tableRows.some(existing => existing[primaryKey] === row[primaryKey]));

        if (duplicate) {
          return {
            data: null,
            error: { message: `Duplicate value for ${primaryKey}`, code: '23505' },
          };
        }

        tableRows.push(...incoming);
        writeState(state);
        resultRows = incoming;
      }

      if (this.operation === 'update') {
        const patch = clone((this.payload || {}) as DatabaseRow);
        const updatedAt = new Date().toISOString();

        for (let index = 0; index < tableRows.length; index += 1) {
          if (!this.matches(tableRows[index])) continue;
          tableRows[index] = { ...tableRows[index], ...patch, updated_at: updatedAt };
          resultRows.push(tableRows[index]);
        }
        writeState(state);
      }

      if (this.orderBy) {
        const { column, ascending } = this.orderBy;
        resultRows.sort((left, right) => {
          const a = left[column];
          const b = right[column];
          if (a === b) return 0;
          return (a < b ? -1 : 1) * (ascending ? 1 : -1);
        });
      }

      if (this.rowLimit !== null) resultRows = resultRows.slice(0, this.rowLimit);
      const projected = resultRows.map(row => this.project(row));

      if (mode === 'single' && projected.length !== 1) {
        return { data: null, error: { message: 'Expected exactly one row', code: 'PGRST116' } };
      }
      if (mode === 'maybeSingle' && projected.length > 1) {
        return { data: null, error: { message: 'Expected at most one row', code: 'PGRST116' } };
      }
      if (mode !== 'many') return { data: projected[0] ?? null, error: null };

      const shouldReturnRows = this.operation === 'select' || this.returnRows;
      return { data: shouldReturnRows ? projected : null, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : 'Local database error' },
      };
    }
  }
}

export const createLocalDatabaseClient = () => ({
  from(table: string) {
    if (table !== 'players' && table !== 'market_offers') {
      throw new Error(`Unknown local database table: ${table}`);
    }
    return new LocalQueryBuilder(table);
  },
});
