function timeStamp() {
  return new Date().toISOString().split('T')[1].split('Z')[0];
}

export const logger = {
  info: (msg: string) => console.log(`[${timeStamp()}] ${msg}`),
  warn: (msg: string) => console.warn(`[${timeStamp()}] ${msg}`),
  error: (msg: string) => console.error(`[${timeStamp()}] ${msg}`)
};

export default logger;
