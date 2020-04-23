import childProcess from "child_process";
import pino, { PrettyOptions } from "pino";
import { multistream } from "pino-multi-stream";

import { ENABLE_GUI } from "../constants";

const pinoPretty = require("pino-pretty");
const { getPrettyStream: pinoGetPrettyStream } = require("pino/lib/tools");

const teeStream = childProcess.spawn(
  process.execPath,
  [
    require.resolve("pino-tee"),
    "debug",
    "logs/debug.log",
    "info",
    "logs/info.log",
    "error",
    "logs/error.log",
  ],
  {
    cwd: process.cwd(),
    env: process.env,
  },
);

const prettyConsoleStream = pinoGetPrettyStream(
  { translateTime: true, ignore: "hostname,pid" } as PrettyOptions,
  pinoPretty,
  process.stdout,
);

const logger = pino(
  {},
  multistream([
    ...(!ENABLE_GUI ? [{ stream: prettyConsoleStream }] : []),
    { stream: teeStream.stdin },
  ]),
);

export default logger;
