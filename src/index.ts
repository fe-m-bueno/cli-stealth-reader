#!/usr/bin/env node
import { runTui } from "./tui.js";

const args = process.argv.slice(2);
const resume = args.includes("--resume");

await runTui({ resume });
