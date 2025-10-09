import { NextResponse } from 'next/server';

export async function POST() {
  console.log("✅ reminders route reached");
  return NextResponse.json({ ok: true, message: "Reminders route is working" });
}
