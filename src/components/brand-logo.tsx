import Image from "next/image";

import { cn } from "@/lib/utils";

export function BrandLogo({
  className,
  priority = false,
  variant = "full",
}: {
  className?: string;
  priority?: boolean;
  variant?: "full" | "mark";
}) {
  if (variant === "mark") {
    return (
      <div className={cn("relative size-8 overflow-hidden", className)}>
        <Image
          src="/brand/etech-logo.png"
          alt="Easy Technology"
          width={120}
          height={48}
          priority={priority}
          className="absolute left-0 top-1/2 h-7 w-auto -translate-y-1/2 object-contain object-left"
        />
      </div>
    );
  }

  return (
    <Image
      src="/brand/etech-logo.png"
      alt="Easy Technology"
      width={220}
      height={72}
      priority={priority}
      className={cn("h-10 w-auto object-contain sm:h-12", className)}
    />
  );
}
