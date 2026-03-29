import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(req) {
  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    let event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error(`Webhook signature verification failed: ${err.message}`);
      return NextResponse.json({ error: "Webhook signature verification failed" }, { status: 400 });
    }

    // Handle checkout session completed
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // Check if payment was successful
      if (session.payment_status === "paid") {
        await fulfillOrder(session);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Unhandled webhook error:", error);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}

async function fulfillOrder(session) {
  const { userId, hours } = session.metadata;

  if (!userId || !hours) {
    console.error("Fulfillment failed: missing metadata fields userId or hours", session.metadata);
    return;
  }

  console.log(`Fulfilling order for User ${userId}: Adding ${hours} hours.`);

  // Create a service role Supabase client to bypass RLS and securely update balances
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY 
    // ^ Ideally use a service_role_key in production, using anon key here for dev environment 
    // but the table MUST have RLS policies permitting this action if using anon key.
    // Assuming backend runs with service_role or we create an RPC function.
  );

  // 1. Log transaction
  const { error: txError } = await supabase.from("credit_transactions").insert({
    user_id: userId,
    type: "purchase",
    hours: parseFloat(hours),
    description: `Purchased ${hours} hours via Stripe`,
    stripe_session_id: session.id,
  });

  if (txError) {
    console.error("Failed to insert credit_transaction:", txError);
    // Don't throw, still try to update balance
  }

  // 2. Update user profile balance
  // Note: Race conditions exist with simple UPDATE. It's safer to use an RPC function:
  // create function increment_credits(user_id uuid, amount numeric)
  
  // For now, doing direct fetch then update:
  const { data: profile } = await supabase
    .from("profiles")
    .select("credits_hours")
    .eq("id", userId)
    .single();

  const currentHours = profile?.credits_hours || 0;
  const newHours = parseFloat(currentHours) + parseFloat(hours);

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ credits_hours: newHours })
    .eq("id", userId);

  if (updateError) {
    console.error("Failed to update profile credits:", updateError);
  } else {
    console.log(`Successfully credited ${hours} hours to user ${userId}. New balance: ${newHours}`);
  }
}
