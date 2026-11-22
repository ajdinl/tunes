// Listens to /api/events like a browser tab would, collecting the events for assertions.
export function listen(url) {
  const ctrl = new AbortController();
  const events = [];
  const waiters = [];
  const ready = fetch(url + '/api/events', { signal: ctrl.signal }).then(async (res) => {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) !== -1) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const type = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (!type) continue;
            const ev = { type, data: data ? JSON.parse(data) : null };
            events.push(ev);
            for (const w of [...waiters]) if (w.test(ev)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(ev); }
          }
        }
      } catch { /* closed */ }
    })();
  });
  return {
    events,
    ready,
    next(type, pred = () => true, timeout = 5000) {
      const found = events.find((e) => e.type === type && pred(e.data));
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const w = { test: (e) => e.type === type && pred(e.data), resolve };
        waiters.push(w);
        setTimeout(() => reject(new Error(`No "${type}" event within ${timeout} ms`)), timeout);
      });
    },
    close: () => ctrl.abort(),
  };
}
