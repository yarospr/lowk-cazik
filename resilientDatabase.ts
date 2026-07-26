type QueryMode = 'many' | 'single' | 'maybeSingle';

let remoteUnavailable = false;

const shouldUseLocalFallback = (error: any) => {
  if (!error) return false;

  const code = String(error.code || error.status || '').toUpperCase();
  const message = String(error.message || error.details || error).toLowerCase();

  return ['PGRST205', '42P01', '42501', '401', '403'].includes(code)
    || message.includes('failed to fetch')
    || message.includes('network')
    || message.includes('abort')
    || message.includes('timeout')
    || message.includes('permission denied');
};

class ResilientQueryBuilder implements PromiseLike<any> {
  constructor(
    private remoteQuery: any,
    private localQuery: any,
  ) {}

  select(...args: any[]) {
    this.remoteQuery = this.remoteQuery.select(...args);
    this.localQuery = this.localQuery.select(...args);
    return this;
  }

  insert(...args: any[]) {
    this.remoteQuery = this.remoteQuery.insert(...args);
    this.localQuery = this.localQuery.insert(...args);
    return this;
  }

  update(...args: any[]) {
    this.remoteQuery = this.remoteQuery.update(...args);
    this.localQuery = this.localQuery.update(...args);
    return this;
  }

  eq(...args: any[]) {
    this.remoteQuery = this.remoteQuery.eq(...args);
    this.localQuery = this.localQuery.eq(...args);
    return this;
  }

  neq(...args: any[]) {
    this.remoteQuery = this.remoteQuery.neq(...args);
    this.localQuery = this.localQuery.neq(...args);
    return this;
  }

  in(...args: any[]) {
    this.remoteQuery = this.remoteQuery.in(...args);
    this.localQuery = this.localQuery.in(...args);
    return this;
  }

  order(...args: any[]) {
    this.remoteQuery = this.remoteQuery.order(...args);
    this.localQuery = this.localQuery.order(...args);
    return this;
  }

  limit(...args: any[]) {
    this.remoteQuery = this.remoteQuery.limit(...args);
    this.localQuery = this.localQuery.limit(...args);
    return this;
  }

  single() {
    return this.execute('single');
  }

  maybeSingle() {
    return this.execute('maybeSingle');
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute('many').then(onfulfilled, onrejected);
  }

  private runLocal(mode: QueryMode) {
    return mode === 'many' ? this.localQuery : this.localQuery[mode]();
  }

  private async execute(mode: QueryMode) {
    if (remoteUnavailable) return this.runLocal(mode);

    try {
      const remoteResult = mode === 'many'
        ? await this.remoteQuery
        : await this.remoteQuery[mode]();

      if (!shouldUseLocalFallback(remoteResult?.error)) return remoteResult;
    } catch (error) {
      if (!shouldUseLocalFallback(error)) throw error;
    }

    remoteUnavailable = true;
    console.warn('Supabase is unavailable; switching this session to the local database');
    return this.runLocal(mode);
  }
}

export const createResilientDatabaseClient = (remoteClient: any, localClient: any) => ({
  from(table: string) {
    return new ResilientQueryBuilder(remoteClient.from(table), localClient.from(table));
  },
});
