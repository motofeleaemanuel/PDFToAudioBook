"use client";

import { useState, useEffect, Suspense } from "react";
import { Check, CreditCard, Sparkles, Loader2, Library, Calculator, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth-provider";
import { useSearchParams } from "next/navigation";

function BillingContent() {
  const { user, supabase } = useAuth();

  const searchParams = useSearchParams();
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkingOutPack, setCheckingOutPack] = useState(null);
  
  const success = searchParams.get("success");
  const canceled = searchParams.get("canceled");

  useEffect(() => {
    if (user?.id) {
      fetchBalance();
    }
  }, [user?.id]);

  const fetchBalance = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("credits_hours")
        .eq("id", user.id)
        .single();
        
      if (!error && data) {
        setBalance(parseFloat(data.credits_hours || 0).toFixed(1));
      }
    } catch (e) {
      console.error("Error fetching balance:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckout = async (packId) => {
    setCheckingOutPack(packId);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || "Checkout failed");
        setCheckingOutPack(null);
      }
    } catch (e) {
      console.error("Checkout error:", e);
      alert("Something went wrong");
      setCheckingOutPack(null);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto w-full space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3 bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">
          <CreditCard className="h-8 w-8 text-primary" />
          Billing & Credits
        </h1>
        <p className="text-muted-foreground mt-2">Add more audio hours to your account using Stripe secure checkout.</p>
      </div>

      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 p-4 rounded-xl flex items-center gap-3">
          <Check className="h-5 w-5" />
          <p className="text-sm font-medium">Payment successful! Your credits have been added to your account.</p>
        </div>
      )}

      {canceled && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-xl">
          <p className="text-sm font-medium">Payment was canceled. No charges were made.</p>
        </div>
      )}

      <div className="bg-background/80 backdrop-blur-xl border border-primary/20 shadow-lg shadow-primary/5 rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-transparent pointer-events-none" />
        <div>
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-widest mb-1">Current Balance</h2>
          <div className="text-5xl font-extrabold tracking-tighter text-foreground flex items-baseline gap-2">
            {loading ? (
              <div className="h-12 w-32 bg-white/5 animate-pulse rounded-lg" />
            ) : (
              <>
                {balance} <span className="text-2xl font-semibold text-muted-foreground/50">hrs</span>
              </>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-2.5 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-500" />
            Enough for approximately {balance ? Math.floor(balance / 5) : 0} average books.
          </p>
        </div>
        <Button 
          size="lg" 
          variant="outline"
          className="shrink-0 w-full md:w-auto h-12 px-8 text-base border-white/10"
          onClick={fetchBalance}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh Balance"}
        </Button>
      </div>

      <h2 className="text-xl font-bold mt-12 mb-6">Buy More Credits</h2>
      <div className="grid md:grid-cols-3 gap-6">
        <PricingCard 
          id="starter"
          title="Starter Pack" 
          hours={10} 
          price={14.99} 
          features={["10 hours of high-definition TTS", "Full Vision OCR included", "Perfect for short documents"]} 
          onCheckout={handleCheckout}
          isLoading={checkingOutPack === "starter"}
          icon={BookOpen}
        />
        <PricingCard 
          id="scholar"
          title="Scholar Pack" 
          hours={30} 
          price={39.99} 
          isPopular
          features={["30 hours of high-definition TTS", "Full Vision OCR included", "Saves 10%", "Perfect for a semester"]} 
          onCheckout={handleCheckout}
          isLoading={checkingOutPack === "scholar"}
          icon={Calculator}
        />
        <PricingCard 
          id="library"
          title="Library Pack" 
          hours={100} 
          price={99.99} 
          features={["100 hours of premium audio", "Full Vision OCR included", "Saves 33%", "For heavy researchers"]} 
          onCheckout={handleCheckout}
          isLoading={checkingOutPack === "library"}
          icon={Library}
        />
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={
      <div className="p-8 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <BillingContent />
    </Suspense>
  );
}

function PricingCard({ id, title, hours, price, features, isPopular = false, onCheckout, isLoading, icon: Icon }) {
  return (
    <Card className={`bg-background/60 backdrop-blur-xl transition-all duration-300 relative overflow-hidden flex flex-col ${isPopular ? "border-primary shadow-2xl shadow-primary/20 scale-[1.02]" : "border-white/5 shadow-xl hover:border-primary/30"}`}>
      {isPopular && (
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-primary to-cyan-400" />
      )}
      <CardHeader>
        {isPopular && <div className="text-xs font-bold text-primary uppercase tracking-wider mb-2 flex items-center gap-1"><Sparkles className="h-3 w-3" /> Most Popular</div>}
        <CardTitle className="flex items-center gap-2">
          {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
          {title}
        </CardTitle>
        <CardDescription>{hours} Audio Hours</CardDescription>
        <div className="mt-4 text-4xl font-bold tracking-tight">
          ${price}<span className="text-sm font-normal text-muted-foreground">/one-time</span>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <ul className="space-y-2.5 text-sm hidden md:block">
          {features.map((feature, i) => (
            <li key={i} className="flex items-start gap-2">
              <div className="rounded-full bg-primary/10 p-0.5 mt-0.5 shrink-0">
                <Check className="h-3 w-3 text-primary" />
              </div>
              <span className="text-muted-foreground leading-snug">{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Button 
          className="w-full text-sm h-11 transition-all" 
          variant={isPopular ? "default" : "secondary"}
          onClick={() => onCheckout(id)}
          disabled={isLoading}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {isLoading ? "Redirecting..." : `Buy ${hours} Hours`}
        </Button>
      </CardFooter>
    </Card>
  );
}

