import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const SKILL_NAME = /^[a-z][a-z0-9_-]*$/

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  if (!SKILL_NAME.test(name)) {
    return NextResponse.json({ error: "invalid skill name" }, { status: 400 })
  }

  const skillPath = path.join(process.cwd(), ".claude", "skills", name, "SKILL.md")
  if (!fs.existsSync(skillPath)) {
    return NextResponse.json({ error: "skill not found" }, { status: 404 })
  }

  const content = fs.readFileSync(skillPath, "utf-8")
  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="SKILL.md"`,
    },
  })
}
