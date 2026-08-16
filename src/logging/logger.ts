function timeHHMMSS() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatProps(obj?: Record<string, any>) {
  if (!obj) return '';
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ');
}

function writeLine(tag: string, msg?: string, props?: Record<string, any>) {
  const time = timeHHMMSS();
  const propsText = formatProps(props);
  const base = propsText ? `${time} ${tag} ${propsText}` : `${time} ${tag}`;
  console.log(msg ? `${base} ${msg}` : base);
}

export const logger = {
  info: (msg: string) => writeLine('INFO', msg),
  warn: (msg: string) => writeLine('WARN', msg),
  error: (msg: string, props?: Record<string, any>) => writeLine('ERROR', msg, props),

  // Role-specific helpers produce lines like: "16:20:05 ROUTER provider=groq selected"
  master: (msg?: string, props?: Record<string, any>) => writeLine('MASTER', msg, props),
  agent: (msg?: string, props?: Record<string, any>) => writeLine('AGENT', msg, props),
  router: (msg?: string, props?: Record<string, any>) => writeLine('ROUTER', msg, props)
};

export default logger;
