import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";

// Initialize Stripe with the secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16", // or latest
});

// Define credit pack definitions
const CREDIT_PACKS = {
  starter: {
    hours: 10,
    priceCents: 1499,
    name: "Starter Pack (10 Hours)",
  },
  scholar: {
    hours: 30,
    priceCents: 3999,
    name: "Scholar Pack (30 Hours)",
  },
  library: {
    hours: 100,
    priceCents: 9999,
    name: "Library Pack (100 Hours)",
  },
};

export async function POST(req) {
  try {
    // 1. Authenticate user
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse request
    const body = await req.json();
    const { packId } = body;

    const pack = CREDIT_PACKS[packId];
    if (!pack) {
      return NextResponse.json({ error: "Invalid credit pack" }, { status: 400 });
    }

    // 3. Create Stripe Checkout Session
    const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: pack.name,
              description: `Adds ${pack.hours} hours of high-definition AI voice generation to your account.`,
            },
            unit_amount: pack.priceCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${origin}/dashboard/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/dashboard/billing?canceled=true`,
      customer_email: user.email,
      metadata: {
        userId: user.id,
        hours: pack.hours.toString(),
        packId: packId,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe Checkout Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
