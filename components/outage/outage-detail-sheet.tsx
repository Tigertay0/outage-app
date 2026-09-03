"use client";

import { useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  MessageSquare,
  Send,
  ThumbsUp,
} from "lucide-react";
import { SEVERITY_META, VERIFICATION_THRESHOLD } from "@/lib/constants";
import { clockTime, dayAndTime, locationLabel, outageDuration, pluralize, timeAgo } from "@/lib/format";
import {
  useAddComment,
  useConfirmOutage,
  useOutageDetail,
  useResolveOutage,
} from "@/lib/hooks/use-outages";
import { buildTimeline } from "@/lib/timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { ServiceIcon } from "@/components/map/markers";
import { OutageTimeline } from "./outage-timeline";

/**
 * Outage detail (PRD sections 4.1, 4.6, 4.9).
 *
 * Confirm is the primary action and sits above the fold on every screen size —
 * it is the single interaction the crowdsourcing model depends on.
 */
export function OutageDetailSheet({
  outageId,
  onOpenChange,
}: {
  outageId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: outage, isLoading } = useOutageDetail(outageId);
  const confirm = useConfirmOutage(outageId ?? "");
  const resolve = useResolveOutage(outageId ?? "");
  const addComment = useAddComment(outageId ?? "");
  const { toast } = useToast();

  const [draft, setDraft] = useState("");

  async function submitComment() {
    const text = draft.trim();
    if (!text) return;

    try {
      await addComment.mutateAsync(text);
      setDraft("");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Comment not posted",
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  const isResolved = outage?.status === "resolved";
  const remaining = outage
    ? Math.max(0, VERIFICATION_THRESHOLD - outage.verificationCount)
    : 0;

  return (
    <Sheet open={outageId !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[85vh] flex-col sm:mx-auto sm:max-w-lg sm:rounded-t-2xl"
      >
        {isLoading || !outage ? (
          <div className="flex items-center justify-center py-16">
            {/* Radix requires a title on every dialog for screen readers, so
                the loading state announces itself rather than opening silent. */}
            <SheetTitle className="sr-only">Loading outage details</SheetTitle>
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <SheetHeader className="pr-12">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  style={{
                    backgroundColor: isResolved
                      ? "var(--severity-resolved)"
                      : SEVERITY_META[outage.severity].token,
                  }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
                >
                  <ServiceIcon type={outage.serviceType} className="h-4 w-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate">
                    {outage.providerName ?? "Unknown provider"}
                  </SheetTitle>
                  <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {locationLabel(outage)}
                  </p>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant={isResolved ? "resolved" : outage.severity}>
                  {isResolved
                    ? "Resolved"
                    : SEVERITY_META[outage.severity].label}
                </Badge>

                {outage.isVerified && (
                  <Badge variant="outline">
                    <BadgeCheck className="h-3 w-3" />
                    Verified
                  </Badge>
                )}

                <Badge variant="outline">
                  <Clock className="h-3 w-3" />
                  {isResolved
                    ? `Lasted ${outageDuration(outage)}`
                    : `Out for ${outageDuration(outage)}`}
                </Badge>

                {outage.estimatedRestoration && !isResolved && (
                  <Badge variant="secondary">
                    Back by {clockTime(outage.estimatedRestoration)}
                  </Badge>
                )}
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-5">
              {outage.description && (
                <p className="py-3 text-sm">{outage.description}</p>
              )}

              {!isResolved && (
                <div className="flex gap-2 py-2">
                  <Button
                    variant={outage.confirmedByMe ? "secondary" : "default"}
                    onClick={() => confirm.mutate(!outage.confirmedByMe)}
                    disabled={confirm.isPending}
                    className="flex-1"
                  >
                    <ThumbsUp className="h-4 w-4" />
                    {outage.confirmedByMe
                      ? "Confirmed"
                      : "I'm affected too"}
                    <span className="tabular-nums opacity-70">
                      {outage.verificationCount}
                    </span>
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => resolve.mutate()}
                    disabled={resolve.isPending}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    It&apos;s back
                  </Button>
                </div>
              )}

              {!isResolved && remaining > 0 && (
                <p className="pb-2 text-xs text-muted-foreground">
                  {remaining} more {pluralize(remaining, "confirmation")} to mark
                  this verified.
                </p>
              )}

              <Tabs defaultValue="updates" className="pb-4">
                <TabsList className="w-full">
                  <TabsTrigger value="updates" className="flex-1">
                    Updates
                    {outage.comments.length > 0 && (
                      <span className="ml-1 tabular-nums opacity-60">
                        {outage.comments.length}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="timeline" className="flex-1">
                    Timeline
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="updates" className="pt-3">
                  {outage.comments.length === 0 ? (
                    <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                      <MessageSquare className="h-4 w-4" />
                      No updates yet. Add the first one.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {outage.comments.map((comment) => (
                        <li key={comment.id} className="text-sm">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-medium">
                              {comment.authorLabel}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {timeAgo(comment.createdAt)}
                            </span>
                          </div>
                          <p className="text-muted-foreground">
                            {comment.comment}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                <TabsContent value="timeline" className="pt-3">
                  <OutageTimeline events={buildTimeline(outage)} />
                </TabsContent>
              </Tabs>
            </div>

            <div className="border-t px-5 py-3">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitComment();
                }}
                className="flex gap-2"
              >
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Add an update…"
                  maxLength={500}
                  aria-label="Add an update"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!draft.trim() || addComment.isPending}
                  aria-label="Post update"
                >
                  {addComment.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>

              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Reported {dayAndTime(outage.reportedAt)}
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
