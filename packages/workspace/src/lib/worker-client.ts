/**
 * A Web Worker (ADR-0004) started on the first request and kept for the next.
 * `post` sends the request `make` builds with a fresh `id` and resolves with
 * the answer carrying that id. A worker that fails to load answers every
 * waiting request with `failed`, calls `onFailure`, and the next request
 * starts another. `start` creates the worker, so bundlers see its URL.
 */
export function workerClient<Request extends { id: number }, Response extends { id: number }>(
  start: () => Worker,
  failed: (id: number) => Response,
  onFailure: () => void = () => {},
) {
  let worker: Worker | null = null;
  const waiting = new Map<number, (response: Response) => void>();
  let nextId = 0;

  function running(): Worker {
    if (worker) return worker;
    const started = start();
    started.onmessage = ({ data }: MessageEvent<Response>) => {
      const answer = waiting.get(data.id);
      waiting.delete(data.id);
      answer?.(data);
    };
    started.onerror = (event) => {
      event.preventDefault();
      started.terminate();
      worker = null;
      onFailure();
      for (const [id, answer] of waiting) answer(failed(id));
      waiting.clear();
    };
    worker = started;
    return started;
  }

  return {
    post(make: (id: number) => Request, transfer: Transferable[] = []): Promise<Response> {
      const request = make(nextId++);
      const target = running();
      return new Promise((resolve) => {
        waiting.set(request.id, resolve);
        target.postMessage(request, transfer);
      });
    },
  };
}
