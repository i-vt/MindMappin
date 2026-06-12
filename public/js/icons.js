// Node icons. Emoji keep the app asset-free and portable. The first entry
// (empty) clears the icon. Blumind shipped smileys, stars, flags, arrows, etc.
export const ICONS = [
  { id: "", label: "None", glyph: "" },
  { id: "star", label: "Star", glyph: "⭐" },
  { id: "flag", label: "Flag", glyph: "🚩" },
  { id: "check", label: "Done", glyph: "✅" },
  { id: "cross", label: "Blocked", glyph: "❌" },
  { id: "warn", label: "Warning", glyph: "⚠️" },
  { id: "question", label: "Question", glyph: "❓" },
  { id: "idea", label: "Idea", glyph: "💡" },
  { id: "fire", label: "Hot", glyph: "🔥" },
  { id: "pin", label: "Pinned", glyph: "📌" },
  { id: "calendar", label: "Date", glyph: "📅" },
  { id: "clock", label: "Time", glyph: "⏰" },
  { id: "target", label: "Goal", glyph: "🎯" },
  { id: "rocket", label: "Launch", glyph: "🚀" },
  { id: "bug", label: "Bug", glyph: "🐞" },
  { id: "money", label: "Cost", glyph: "💰" },
  { id: "people", label: "Team", glyph: "👥" },
  { id: "heart", label: "Favorite", glyph: "❤️" },
  { id: "smile", label: "Smile", glyph: "🙂" },
  { id: "frown", label: "Concern", glyph: "🙁" },
  { id: "up", label: "Up", glyph: "⬆️" },
  { id: "down", label: "Down", glyph: "⬇️" },
  { id: "note", label: "Note", glyph: "📝" },
  { id: "lock", label: "Locked", glyph: "🔒" },
];

export const ICON_BY_ID = Object.fromEntries(ICONS.map((i) => [i.id, i.glyph]));
