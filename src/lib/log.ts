const isProd = import.meta.env.PROD;

type Logger = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export const log: Logger = isProd
  ? {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (...args) => {
        // eslint-disable-next-line no-console
        console.error(...args);
      },
    }
  : {
      // eslint-disable-next-line no-console
      debug: (...args) => console.debug("[orion]", ...args),
      // eslint-disable-next-line no-console
      info: (...args) => console.info("[orion]", ...args),
      // eslint-disable-next-line no-console
      warn: (...args) => console.warn("[orion]", ...args),
      // eslint-disable-next-line no-console
      error: (...args) => console.error("[orion]", ...args),
    };
