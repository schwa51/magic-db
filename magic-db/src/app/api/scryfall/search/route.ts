import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  if (!q) return NextResponse.json({ error: "Missing q" }, { status: 400 });

  const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}`;

  const r = await fetch(url, {
    headers: { "User-Agent": "magic-db/1.0" },
  });

  const data = await r.json();
  return NextResponse.json(data, { status: r.status });
}
