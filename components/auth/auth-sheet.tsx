"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, LogOut, MailCheck, UserRound } from "lucide-react";
import { useCreateAccount, useSignIn, useSignOut } from "@/lib/hooks/use-auth";
import type { SessionInfo } from "@/lib/hooks/use-outages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";

/** Supabase's own minimum. Stated up front rather than after a failed submit. */
const MIN_PASSWORD = 6;

/**
 * Account sheet (PRD section 4.3).
 *
 * Framed around what an account actually buys, which is syncing across devices
 * — everything else already works as a guest. The copy says so, because "create
 * an account" with no stated benefit is the most skippable thing in any app.
 */
export function AuthSheet({
  open,
  onOpenChange,
  session,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: SessionInfo | undefined;
}) {
  const isSignedIn = Boolean(session?.identity.email);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[85vh] flex-col sm:mx-auto sm:max-w-lg sm:rounded-t-2xl"
      >
        {isSignedIn ? (
          <SignedIn session={session!} onOpenChange={onOpenChange} />
        ) : (
          <SignedOut onOpenChange={onOpenChange} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function SignedIn({
  session,
  onOpenChange,
}: {
  session: SessionInfo;
  onOpenChange: (open: boolean) => void;
}) {
  const signOut = useSignOut();
  const { toast } = useToast();

  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle>Your account</SheetTitle>
        <SheetDescription>{session.identity.email}</SheetDescription>
      </SheetHeader>

      <div className="flex-1 px-5 py-3">
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-severity-resolved" />
          Your filters, saved places and reports follow you to any device you
          sign in on.
        </p>
      </div>

      <div className="border-t px-5 py-4">
        <Button
          variant="outline"
          className="w-full"
          disabled={signOut.isPending}
          onClick={async () => {
            try {
              await signOut.mutateAsync();
              toast({
                title: "Signed out",
                description: "You can keep using the map as a guest.",
              });
              onOpenChange(false);
            } catch (error) {
              toast({
                variant: "destructive",
                title: "Could not sign out",
                description:
                  error instanceof Error ? error.message : "Please try again.",
              });
            }
          }}
        >
          {signOut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4" />
          )}
          Sign out
        </Button>
      </div>
    </>
  );
}

function SignedOut({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(
    null,
  );

  if (confirmationSentTo) {
    return (
      <>
        <SheetHeader className="pr-12">
          <SheetTitle>Check your email</SheetTitle>
          <SheetDescription>
            We sent a confirmation link to {confirmationSentTo}.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 px-5 py-4">
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
            Open the link to finish setting up your account. Until then you can
            carry on as a guest — nothing you have reported is lost.
          </p>
        </div>

        <div className="border-t px-5 py-4">
          <Button className="w-full" onClick={() => onOpenChange(false)}>
            Back to the map
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle>Save your setup</SheetTitle>
        <SheetDescription>
          Reporting and confirming already work without an account. Sign in to
          carry your filters, saved places and reports to another device.
        </SheetDescription>
      </SheetHeader>

      <Tabs defaultValue="create" className="flex min-h-0 flex-1 flex-col">
        <div className="px-5 pt-3">
          <TabsList className="w-full">
            <TabsTrigger value="create" className="flex-1">
              Create account
            </TabsTrigger>
            <TabsTrigger value="signin" className="flex-1">
              Sign in
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="create" className="min-h-0 flex-1 overflow-y-auto">
          <CredentialsForm
            mode="create"
            onOpenChange={onOpenChange}
            onConfirmationSent={setConfirmationSentTo}
          />
        </TabsContent>

        <TabsContent value="signin" className="min-h-0 flex-1 overflow-y-auto">
          <CredentialsForm
            mode="signin"
            onOpenChange={onOpenChange}
            onConfirmationSent={setConfirmationSentTo}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

function CredentialsForm({
  mode,
  onOpenChange,
  onConfirmationSent,
}: {
  mode: "create" | "signin";
  onOpenChange: (open: boolean) => void;
  onConfirmationSent: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const createAccount = useCreateAccount();
  const signIn = useSignIn();
  const { toast } = useToast();

  const mutation = mode === "create" ? createAccount : signIn;
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "create" && password.length < MIN_PASSWORD) return;

    try {
      const result = await mutation.mutateAsync({
        email: email.trim(),
        password,
      });

      if (!result.signedIn) {
        onConfirmationSent(result.email || email.trim());
        return;
      }

      toast({
        title: mode === "create" ? "Account created" : "Signed in",
        description: result.upgraded
          ? "Everything you reported as a guest is still yours."
          : "Your saved setup is available on this device.",
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: mode === "create" ? "Could not create account" : "Could not sign in",
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-4">
      <div>
        <Label htmlFor={`${mode}-email`} className="mb-1.5 block">
          Email
        </Label>
        <Input
          id={`${mode}-email`}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
        />
      </div>

      <div>
        <Label htmlFor={`${mode}-password`} className="mb-1.5 block">
          Password
        </Label>
        <Input
          id={`${mode}-password`}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={mode === "create" ? MIN_PASSWORD : undefined}
          autoComplete={mode === "create" ? "new-password" : "current-password"}
          aria-describedby={mode === "create" ? `${mode}-hint` : undefined}
        />
        {mode === "create" && (
          <p
            id={`${mode}-hint`}
            className={`mt-1.5 text-xs ${tooShort ? "text-destructive" : "text-muted-foreground"}`}
          >
            At least {MIN_PASSWORD} characters.
          </p>
        )}
      </div>

      {mode === "signin" && (
        // Said before they commit, not after: signing in to a different account
        // swaps identities, and the guest session's reports stay with the guest.
        <p className="text-xs text-muted-foreground">
          Signing in to a different account leaves anything you reported as a
          guest on this device attached to that guest.
        </p>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={mutation.isPending || !email || !password}
      >
        {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {mode === "create" ? "Create account" : "Sign in"}
      </Button>
    </form>
  );
}

/** The map's entry point into all of the above. */
export function AccountButton({
  session,
  onClick,
}: {
  session: SessionInfo | undefined;
  onClick: () => void;
}) {
  const email = session?.identity.email;

  return (
    <Button
      variant="secondary"
      size="icon"
      onClick={onClick}
      aria-label={email ? `Account: ${email}` : "Sign in or create an account"}
      title={email ?? "Account"}
      className="relative h-11 w-11 rounded-full shadow-lg"
    >
      <UserRound className="h-4 w-4" />
      {email && (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-background bg-severity-resolved"
        />
      )}
    </Button>
  );
}
