type LogMetadata = Record<string, unknown>;

function write(level: "info" | "warn" | "error", message: string, metadata?: LogMetadata) {
  const line = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(metadata ? { metadata } : {})
  };

  const output = JSON.stringify(line);
  if (level === "error") {
    console.error(output);
    return;
  }

  if (level === "warn") {
    console.warn(output);
    return;
  }

  console.log(output);
}

export const logger = {
  info: (message: string, metadata?: LogMetadata) => write("info", message, metadata),
  warn: (message: string, metadata?: LogMetadata) => write("warn", message, metadata),
  error: (message: string, metadata?: LogMetadata) => write("error", message, metadata)
};

