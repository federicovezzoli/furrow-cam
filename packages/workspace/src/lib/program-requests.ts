/**
 * Asks for the program the simulator plays (#683), one request at a time:
 * `update` asks for the `latest` one unless it is the one `played` or an
 * answer is awaited; an answer for a key no longer the latest asks again for
 * the latest, and one that still is goes to `onAnswer`. After `stop`, answers
 * are dropped. `ask` must not reject.
 */
export function programRequests<Wanted extends { key: string }, Answer>(
  ask: (wanted: Wanted) => Promise<Answer>,
  latest: () => Wanted | null,
  onAnswer: (wanted: Wanted, answer: Answer) => void,
) {
  let busy = false;
  let stopped = false;
  function send(wanted: Wanted) {
    busy = true;
    void ask(wanted).then((answer) => {
      busy = false;
      if (stopped) return;
      const now = latest();
      if (now?.key === wanted.key) onAnswer(wanted, answer);
      else if (now) send(now);
    });
  }
  return {
    update(played: string | null) {
      const now = latest();
      if (!busy && !stopped && now && now.key !== played) send(now);
    },
    stop() {
      stopped = true;
    },
  };
}
