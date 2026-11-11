import type { BuildFormInput } from "./types";

type UciForm = Pick<BuildFormInput, "hostname" | "timezone" | "lanIp" | "netmask">;

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

interface Transition {
  date: Date;
  from: number;
  to: number;
}

function offsetMinutes(zone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0));
}

function posixName(minutes: number): string {
  const sign = minutes > 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0");
  return `<${sign}${hh}>`;
}

function posixOffset(minutes: number): string {
  if (minutes === 0) return "0";
  const sign = minutes > 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = abs % 60 === 0 ? "" : `:${String(abs % 60).padStart(2, "0")}`;
  return `${sign}${hh}${mm}`;
}

function ruleFor(date: Date): string {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), month, 0)).getUTCDate();
  const week = day + 7 > daysInMonth ? 5 : Math.ceil(day / 7);
  return `M${month}.${week}.${date.getUTCDay()}/2`;
}

function findTransitions(zone: string, year: number): Transition[] {
  let previous = offsetMinutes(zone, new Date(Date.UTC(year, 0, 1, 12)));
  const transitions: Transition[] = [];
  for (let day = 1; day < 366; day += 1) {
    const date = new Date(Date.UTC(year, 0, 1 + day, 12));
    if (date.getUTCFullYear() !== year) break;
    const current = offsetMinutes(zone, date);
    if (current !== previous) transitions.push({ date, from: previous, to: current });
    previous = current;
  }
  return transitions;
}

export function posixTimezone(zone: string, now: Date = new Date()): string {
  if (zone === "UTC") return "UTC0";

  const january = offsetMinutes(zone, new Date(Date.UTC(now.getUTCFullYear(), 0, 15, 12)));
  const july = offsetMinutes(zone, new Date(Date.UTC(now.getUTCFullYear(), 6, 15, 12)));
  if (january === july) return `${posixName(january)}${posixOffset(january)}`;

  const transitions = findTransitions(zone, now.getUTCFullYear());
  if (transitions.length !== 2) return `${posixName(january)}${posixOffset(january)}`;

  const start = transitions.find((transition) => transition.to > transition.from);
  const end = transitions.find((transition) => transition.to < transition.from);
  if (!start || !end) return `${posixName(january)}${posixOffset(january)}`;

  return `${posixName(start.from)}${posixOffset(start.from)}${posixName(start.to)}${posixOffset(start.to)},${ruleFor(start.date)},${ruleFor(end.date)}`;
}

export function generateUciDefaults(form: UciForm, rootHash: string, options: { now?: Date } = {}): string {
  return `#!/bin/sh
set -e

uci set system.@system[0].hostname=${shellQuote(form.hostname)}
uci set system.@system[0].zonename=${shellQuote(form.timezone)}
uci set system.@system[0].timezone=${shellQuote(posixTimezone(form.timezone, options.now))}
uci commit system

uci set network.lan.ipaddr=${shellQuote(form.lanIp)}
uci set network.lan.netmask=${shellQuote(form.netmask)}
uci commit network

sed -i 's|^root:[^:]*|root:${rootHash}|' /etc/shadow

exit 0
`;
}
