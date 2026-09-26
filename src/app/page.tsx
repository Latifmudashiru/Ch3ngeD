"use client";

import { useRouter } from "next/navigation";
import { Box, Swords } from "lucide-react";
import { Cube3D } from "@/components/cube-3d";

const games = [
  {
    key: "minecraft",
    title: "Minecraft",
    subtitle: "AI Skin Customization",
    description: "Upload skins, transform them with AI, and preview on a rigged character.",
    href: "/minecraft",
    icon: Box,
    cubeColor: "#4ade80",
    border: "hover:border-emerald-400/70",
    accent: "text-emerald-600",
    glow: "group-hover:shadow-emerald-400/20",
  },
  {
    key: "lol",
    title: "League of Legends",
    subtitle: "Champion Editor",
    description: "View and customize LoL champion models with Claude-powered Blender edits.",
    href: "/lol",
    icon: Swords,
    cubeColor: "#f59e0b",
    border: "hover:border-amber-400/70",
    accent: "text-amber-600",
    glow: "group-hover:shadow-amber-400/20",
  },
];

export default function Home() {
  const router = useRouter();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#f2f3f7] px-6">
      <div className="mb-4 flex items-center gap-3">
        <Cube3D color="#8b5cf6" size={40} />
        <h1 className="text-4xl font-bold tracking-tight text-[#040408]">
          CH4NG3D
        </h1>
      </div>
      <p className="mb-12 max-w-md text-center text-[#4b5364]">
        AI-powered game asset studio. Pick a game to start customizing characters.
      </p>

      <div className="grid w-full max-w-2xl grid-cols-1 gap-6 sm:grid-cols-2">
        {games.map((game) => {
          const Icon = game.icon;
          return (
            <button
              key={game.key}
              onClick={() => router.push(game.href)}
              className={`group relative flex flex-col items-start gap-4 rounded-2xl border border-[#c9cdd9] bg-white p-8 text-left shadow-sm transition-all duration-300 ${game.border} ${game.glow} hover:shadow-xl`}
            >
              <div className="relative z-10 flex w-full items-start justify-between">
                <div className={`mb-1 flex items-center gap-2 ${game.accent}`}>
                  <Icon size={20} />
                  <span className="text-xs font-semibold uppercase tracking-[0.2em]">{game.subtitle}</span>
                </div>
                <Cube3D color={game.cubeColor} size={48} />
              </div>
              <div className="relative z-10">
                <h2 className="text-2xl font-bold text-[#040408]">{game.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-[#4b5364]">{game.description}</p>
              </div>
              <div className="relative z-10 mt-auto">
                <span className={`inline-flex items-center gap-1 rounded-lg border border-[#babfcf] px-3 py-1.5 text-xs font-medium text-[#0c0f28] transition group-hover:border-[#99a1b7]`}>
                  Open Studio →
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </main>
  );
}
