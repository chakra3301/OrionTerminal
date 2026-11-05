export function roomServerOrigin(value: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value)) throw new Error('Enter the room server origin.');
  const url = new URL(value);
  if (!(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))
    || url.username || url.password || value.split('://')[1]?.split('/')[0]?.includes('@')
    || url.pathname !== '/' || url.search || url.hash || value.includes('?') || value.includes('#') || url.port === '0') throw new Error('Use HTTPS or a literal loopback HTTP room server, without a path, query or credentials.');
  return `${url.origin}/`;
}
