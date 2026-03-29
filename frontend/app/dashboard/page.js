"use client";

import { useRouter } from "next/navigation";
import { Activity, Clock, Headphones, TrendingUp, Zap, ArrowRight, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getAuthHeaders } from "@/lib/api-auth";
import { Skeleton } from "@/components/ui/skeleton";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

async function fetchDashboardStats() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let credits = 0;
  
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("credits_hours")
      .eq("id", user.id)
      .single();
    if (profile) credits = profile.credits_hours;
  }

  const headers = await getAuthHeaders();
  const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api").replace(/\/$/, "");
  const res = await fetch(`${API_BASE}/audiobooks`, { headers });
  
  let bookCount = 0;
  let pagesCount = 0;
  let storagePercent = 0;
  let books = [];

  if (res.ok) {
    const data = await res.json();
    books = data.audiobooks || [];
    bookCount = books.length;
    pagesCount = books.reduce((sum, b) => sum + (b.total_pages || 0), 0);
    if (data.storage) {
      storagePercent = data.storage.percentage || 0;
    }
  }

  const metrics = [
    {
      title: "Remaining Credits",
      value: `${parseFloat(credits).toFixed(1)} h`,
      subtitle: "Time available for TTS",
      icon: Clock,
    },
    {
      title: "Audiobooks Created",
      value: bookCount.toString(),
      subtitle: "In your library",
      icon: Headphones,
    },
    {
      title: "Pages Processed",
      value: pagesCount.toString(),
      subtitle: "Total extracted",
      icon: Activity,
    },
    {
      title: "Storage Usage",
      value: `${storagePercent}%`,
      subtitle: "Of 1GB limit",
      icon: Zap,
    },
  ];

  // Aggregation for charts
  const timelineDataMap = new Map();
  // Fill last 14 days with 0
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0]; // YYYY-MM-DD
    timelineDataMap.set(dateStr, { 
      date: dateStr, 
      audiobooks: 0, 
      pages: 0, 
      displayDate: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    });
  }

  books.forEach(b => {
    if (b.created_at) {
      const dateStr = b.created_at.split("T")[0];
      if (timelineDataMap.has(dateStr)) {
        const entry = timelineDataMap.get(dateStr);
        entry.audiobooks += 1;
        entry.pages += (b.total_pages || 0);
      }
    }
  });

  const timeline = Array.from(timelineDataMap.values());

  return { metrics, timeline };
}

export default function DashboardPage() {
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ["dashboardStats"],
    queryFn: fetchDashboardStats,
  });

  const DEFAULT_STATS = [
    { title: "Remaining Credits", value: "-", subtitle: "Loading...", icon: Clock },
    { title: "Audiobooks Created", value: "-", subtitle: "Loading...", icon: Headphones },
    { title: "Pages Processed", value: "-", subtitle: "Loading...", icon: Activity },
    { title: "Storage Usage", value: "-", subtitle: "Loading...", icon: Zap },
  ];

  const displayStats = data?.metrics || DEFAULT_STATS;
  const timeline = data?.timeline || [];

  const chartConfigAudiobooks = {
    audiobooks: {
      label: "Audiobooks Generated",
      color: "#8b5cf6", // Violet 500
    },
  };

  const chartConfigPages = {
    pages: {
      label: "Pages Processed",
      color: "#3b82f6", // Blue 500
    },
  };

  return (
    <div className="space-y-8 pb-8">
      {/* Hero Welcome */}
      <div className="relative overflow-hidden rounded-2xl glass-card p-8 md:p-10 border border-white/5">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-600/10 via-transparent to-blue-600/10 pointer-events-none" />
        <div className="relative z-10">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 text-white">
            Welcome back
          </h1>
          <p className="text-lg text-white/70 max-w-2xl">
            Your AI-powered PDF to Audiobook converter is ready. Upload a document to get started, or explore your library.
          </p>
          <div className="flex gap-3 mt-6">
            <Button
              size="lg"
              className="bg-violet-600 hover:bg-violet-700 text-white font-medium"
              onClick={() => router.push('/dashboard/upload')}
            >
              Convert New PDF
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="border-white/10 bg-white/5 hover:bg-white/10 text-white font-medium transition-all"
              onClick={() => router.push('/dashboard/audiobooks')}
            >
              View Library
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {displayStats.map((stat) => (
          <Card key={stat.title} className="glass-card border-white/5 overflow-hidden transition-all hover:border-white/10 group">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-white/70">{stat.title}</CardTitle>
              <div className="p-2 rounded-lg bg-white/5 border border-white/5 group-hover:bg-white/10 transition-colors">
                <stat.icon className="h-4 w-4 text-white/50 group-hover:text-primary" />
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2 mt-1">
                  <Skeleton className="h-8 w-20 bg-white/10" />
                  <Skeleton className="h-3 w-32 bg-white/5" />
                </div>
              ) : stat.title === "Storage Usage" ? (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-3xl font-bold tracking-tight text-white">{stat.value}</div>
                    <p className="text-xs text-white/50 mt-1">{stat.subtitle}</p>
                  </div>
                  <div className="h-16 w-16">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: "Used", value: parseFloat(stat.value) || 0.1 },
                            { name: "Free", value: 100 - (parseFloat(stat.value) || 0) }
                          ]}
                          cx="50%"
                          cy="50%"
                          startAngle={90}
                          endAngle={-270}
                          innerRadius="70%"
                          outerRadius="100%"
                          dataKey="value"
                          stroke="none"
                        >
                          <Cell fill="#8b5cf6" />
                          <Cell fill="rgba(255,255,255,0.1)" />
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <>
                  <div className="text-3xl font-bold tracking-tight text-white">{stat.value}</div>
                  <p className="text-xs text-white/50 mt-1">{stat.subtitle}</p>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Insights / Charts Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Chart 1: Audiobooks Timeline */}
        <Card className="glass-card border-white/5 overflow-hidden flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg font-medium text-white flex items-center gap-2">
              <Headphones className="w-5 h-5 text-violet-500" />
              Audiobook Creation Timeline
            </CardTitle>
            <CardDescription className="text-white/50">Audiobooks generated over the last 14 days.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 pb-4">
            {isLoading ? (
              <Skeleton className="w-full h-[250px] bg-white/5 rounded-xl" />
            ) : (
              <ChartContainer config={chartConfigAudiobooks} className="min-h-[200px] w-full">
                <AreaChart data={timeline} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorAudiobooks" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-audiobooks)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-audiobooks)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis 
                    dataKey="displayDate" 
                    tickLine={false} 
                    axisLine={false} 
                    tickMargin={10}
                    tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} 
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="audiobooks"
                    stroke="var(--color-audiobooks)"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorAudiobooks)"
                  />
                </AreaChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Chart 2: Pages Processed */}
        <Card className="glass-card border-white/5 overflow-hidden flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg font-medium text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-500" />
              Processing Activity
            </CardTitle>
            <CardDescription className="text-white/50">Total pages extracted and processed over the last 14 days.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 pb-4">
            {isLoading ? (
              <Skeleton className="w-full h-[250px] bg-white/5 rounded-xl" />
            ) : (
              <ChartContainer config={chartConfigPages} className="min-h-[200px] w-full">
                <BarChart data={timeline} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis 
                    dataKey="displayDate" 
                    tickLine={false} 
                    axisLine={false} 
                    tickMargin={10} 
                    tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="pages"
                    fill="var(--color-pages)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
