type PublicationOperation = () => Promise<void> | void;
type PublicationErrorHandler = (error: unknown) => void;

const activeRequiredPublications = new Set<Promise<void>>();

/**
 * Retains asynchronous telemetry publications without adding an await to the
 * component hot path. Callers drain the tracker from their outermost finally.
 */
export class RequiredPublicationTracker {
  private readonly publications = new Set<Promise<void>>();

  track(operation: PublicationOperation, onError?: PublicationErrorHandler): void {
    let publication: Promise<void>;
    try {
      publication = Promise.resolve(operation());
    } catch (error: unknown) {
      publication = Promise.reject(error);
    }

    const observedPublication = publication.then(
      () => undefined,
      (error: unknown) => {
        try {
          onError?.(error);
        } catch (handlerError: unknown) {
          console.error('[Telemetry] Publication error handler failed', handlerError);
        }
      },
    );

    this.publications.add(observedPublication);
    activeRequiredPublications.add(observedPublication);

    void observedPublication.then(() => {
      this.publications.delete(observedPublication);
      activeRequiredPublications.delete(observedPublication);
    });
  }

  async drain(): Promise<void> {
    while (this.publications.size > 0) {
      const snapshot = [...this.publications];
      await Promise.allSettled(snapshot);
      for (const publication of snapshot) {
        this.publications.delete(publication);
        activeRequiredPublications.delete(publication);
      }
    }
  }
}

/** Wait for publications still retained by any active execution. */
export async function drainAllRequiredPublications(): Promise<void> {
  while (activeRequiredPublications.size > 0) {
    const snapshot = [...activeRequiredPublications];
    await Promise.allSettled(snapshot);
    for (const publication of snapshot) {
      activeRequiredPublications.delete(publication);
    }
  }
}
