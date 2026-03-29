"use client";

import { useEffect, useState } from "react";

export function AmbientBackground() {
  const [stars, setStars] = useState([]);

  useEffect(() => {
    // Generate random twinkling stars client-side to prevent hydration mismatch
    const newStars = Array.from({ length: 150 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 1,
      duration: Math.random() * 3 + 2,
      delay: Math.random() * 5,
    }));
    setStars(newStars);
  }, []);

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden h-screen w-screen bg-[#03030a]">
      {/* 1. Deep Core Background Glows */}
      <div className="background-glow absolute inset-0 mix-blend-screen" />

      {/* 2. Premium Grid Overlay with precise radial fade */}
      <div 
        className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4rem_4rem]"
        style={{ 
          maskImage: "radial-gradient(ellipse 80% 80% at 50% 10%, #000 10%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 80% at 50% 10%, #000 10%, transparent 100%)"
        }}
      />

      {/* 3. Pure CSS Twinkling Stars */}
      <div className="absolute inset-0 mask-stars">
        {stars.map((star) => (
          <div
            key={star.id}
            className="absolute rounded-full bg-white/80 animate-twinkle"
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: `${star.size}px`,
              height: `${star.size}px`,
              animationDuration: `${star.duration}s`,
              animationDelay: `${star.delay}s`,
            }}
          />
        ))}
      </div>
      
      {/* 4. Subtle Moving Vignette to frame the dashboard */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_0%,rgba(0,0,0,0.4)_100%)] pointer-events-none" />
    </div>
  );
}
