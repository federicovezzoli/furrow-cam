/** What a failing worker reports: when it stops, and when a message can't be read. */
export type WorkerFailures = { stopped: string; unreadable: string };

/**
 * A Web Worker started by `create` on the first `post`, handing its messages
 * to `onMessage`. When it fails to load, crashes or sends a message that
 * can't be read, it is terminated and `onFail` called; the next `post` starts
 * a fresh one. Starting again only when there is work keeps a worker that
 * can't load (a chunk gone after a deploy) from being restarted in a loop.
 *
 * `create` must call `new Worker(new URL("…", import.meta.url))` itself, so
 * the bundler finds the worker's entry point.
 */
export function lazyWorker<Request, Response>(
  create: () => Worker,
  {
    onMessage,
    onFail,
    failures,
  }: {
    onMessage: (response: Response) => void;
    onFail: (error: string) => void;
    failures: WorkerFailures;
  },
) {
  let worker: Worker | null = null;

  function drop(error: string) {
    worker?.terminate();
    worker = null;
    onFail(error);
  }

  function start(): Worker {
    const started = create();
    started.onmessage = ({ data }: MessageEvent<Response>) => onMessage(data);
    started.onerror = (event) => {
      event.preventDefault();
      drop(event.message || failures.stopped);
    };
    started.onmessageerror = () => drop(failures.unreadable);
    return started;
  }

  return {
    post(request: Request) {
      worker ??= start();
      worker.postMessage(request);
    },
    terminate() {
      worker?.terminate();
      worker = null;
    },
  };
}
