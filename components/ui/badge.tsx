import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        // Severity badges carry colour as a border and tint rather than a solid
        // fill, so a row of them does not read as three competing buttons.
        complete:
          "border-severity-complete/30 bg-severity-complete/10 text-severity-complete",
        degraded:
          "border-severity-degraded/30 bg-severity-degraded/10 text-severity-degraded",
        intermittent:
          "border-severity-intermittent/30 bg-severity-intermittent/10 text-severity-intermittent",
        resolved:
          "border-severity-resolved/30 bg-severity-resolved/10 text-severity-resolved",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
