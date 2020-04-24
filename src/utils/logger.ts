import fs from "fs";
import pino, { PrettyOptions } from "pino";
import { multistream } from "pino-multi-stream";

import { ENABLE_GUI } from "../constants";

const pinoPretty = require("pino-pretty");
const pinoTee = require("pino-tee");
const { getPrettyStream: pinoGetPrettyStream } = require("pino/lib/tools");

const prettyConsoleStream = pinoGetPrettyStream(
  { translateTime: true, ignore: "hostname,pid" } as PrettyOptions,
  pinoPretty,
  process.stdout,
);

pino.destination("wd");
const teeStream = pinoTee(process.stdin);
const streams = [
  { dest: "logs/debug.log", filter: (line: any) => line.level >= 0 && line.level < 30 },
  { dest: "logs/info.log", filter: (line: any) => line.level >= 30 && line.level < 50 },
  { dest: "logs/error.log", filter: (line: any) => line.level >= 50 },
];
streams.forEach((stream) =>
  teeStream.tee(fs.createWriteStream(stream.dest, { flags: "a" }), stream.filter),
);

const logger = pino(
  { level: "debug" } as pino.LoggerOptions,
  multistream([
    ...(!ENABLE_GUI ? [{ level: "debug", stream: prettyConsoleStream } as any] : []),
    { level: "debug", stream: teeStream },
  ]),
);

export default logger;
