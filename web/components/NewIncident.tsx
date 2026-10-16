import { Button, Empty } from "@cloudflare/kumo";
import { FirstAidKitIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useLocation } from "wouter";
import { useRateLimitToast } from "../hooks/useRateLimitToast";
import { createIncident, ERROR_TEXT, notifyIncidentsChanged } from "../lib/api";
import { Composer } from "./Composer";

const CHIPS = [
  { label: "Use demo service", text: "What's wrong with my demo service?" },
  { label: "diagnose cloudflare.com", text: "diagnose cloudflare.com" },
];

/** Start screen: describe what's broken; the first message must name a host, URL or "demo" (D9). */
export function NewIncident() {
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rateLimited = useRateLimitToast();

  const send = async (message: string) => {
    setError(null);
    const r = await createIncident(message);
    if (!r.ok) {
      setError(r.error === "rate_limited" ? rateLimited(r.retryAfter) : ERROR_TEXT[r.error]);
      return;
    }
    setText("");
    notifyIncidentsChanged();
    navigate(`/i/${r.id}`);
  };

  return (
    <div className="bg-glow flex min-h-full shrink-0 flex-col">
      <div className="flex flex-1 items-center justify-center p-6">
        <Empty
          icon={<FirstAidKitIcon size={40} aria-hidden />}
          title="What's broken?"
          description="Name a site and describe the problem. Checks run on DNS and HTTP, then you get a diagnosis with evidence."
          contents={
            <div className="flex flex-wrap justify-center gap-2">
              {CHIPS.map((c) => (
                <Button key={c.label} variant="secondary" size="sm" onClick={() => setText(c.text)}>
                  {c.label}
                </Button>
              ))}
            </div>
          }
        />
      </div>
      <Composer
        value={text}
        onChange={setText}
        onSend={send}
        placeholder="e.g. checkout on shop.example.com is returning errors"
        voice
        notice={error && <p role="alert" className="text-(--cf-fg)">{error}</p>}
      />
    </div>
  );
}
