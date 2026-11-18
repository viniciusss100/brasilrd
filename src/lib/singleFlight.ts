/**
 * SingleFlight — evita que requisições idênticas simultâneas disparem
 * múltiplas consultas externas (request coalescing / deduplication).
 *
 * Se duas chamadas com a mesma chave chegam ao mesmo tempo, a segunda
 * aguarda o resultado da primeira sem fazer uma nova requisição.
 */

export class SingleFlight {
  private inflight = new Map<string, Promise<any>>();

  /**
   * Executa fn() garantindo que apenas uma execução ocorra por chave.
   * Chamadas concorrentes com a mesma chave recebem o mesmo Promise.
   */
  async do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = fn().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }

  /** Número de requisições em andamento */
  get size(): number {
    return this.inflight.size;
  }

  /** Cancela rastreamento manual de uma chave (para testes) */
  forget(key: string): void {
    this.inflight.delete(key);
  }
}

/** Instância global compartilhada entre todos os serviços */
export const globalSingleFlight = new SingleFlight();
