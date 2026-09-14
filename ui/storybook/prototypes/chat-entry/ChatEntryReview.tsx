import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ArrowRight, MessageSquare, Search, SquarePen, Star, Users } from "lucide-react";
import type { Agent } from "@paperclipai/shared";
import { AgentIcon } from "@/components/AgentIconPicker";
import { SidebarNavItem } from "@/components/SidebarNavItem";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { useSidebar } from "@/context/SidebarContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Link, useLocation, useNavigate } from "@/lib/router";
import { agentRouteRef, cn } from "@/lib/utils";
import { AgentChat } from "@/pages/AgentChat";
import { chatAgents } from "../agent-chat/AgentChatSidebar";

export type EntryScenario = "first-use" | "returning" | "picker" | "search" | "no-results" | "paused" | "large-team";

const titles: Record<string, string> = {
  "chat-design": "Product Designer", "chat-research": "Research Analyst", "chat-ops": "Operations Lead",
};
export const entryAgents: Agent[] = chatAgents.map((agent) => ({
  ...agent,
  title: titles[agent.id] ?? agent.title,
  status: agent.id === "chat-ops" ? "paused" : "idle",
}));
const extraRoles = ["Content Strategist", "Customer Researcher", "Data Analyst", "Support Specialist", "Growth Marketer", "Security Engineer"];
export function reviewRoster(scenario?: EntryScenario): Agent[] {
  return scenario === "large-team" ? [...entryAgents, ...extraRoles.map((title, index) => ({
    ...entryAgents[0], id: `extra-${index}`, urlKey: `extra-${index}`, name: title, title,
  }))] : entryAgents;
}

interface ReviewState {
  agents: Agent[];
  recent: string[];
  stars: string[];
  openPicker: () => void;
  choose: (agent: Agent) => void;
  toggleStar: (id: string) => void;
}
const ReviewContext = createContext<ReviewState | null>(null);
function useReview() {
  const value = useContext(ReviewContext);
  if (!value) throw new Error("Chat entry review provider is required");
  return value;
}

export function ChatEntryReviewProvider({ scenario, children }: { scenario: EntryScenario; children: ReactNode }) {
  const [open, setOpen] = useState(["picker", "search", "no-results", "large-team"].includes(scenario));
  const [search, setSearch] = useState(scenario === "search" ? "design" : scenario === "no-results" ? "accountant" : "");
  const [recent, setRecent] = useState<string[]>(scenario === "first-use" ? [] : ["agent-codex", "agent-qa", "chat-design"]);
  const [stars, setStars] = useState<string[]>(scenario === "first-use" ? [] : ["agent-cto"]);
  const agents = reviewRoster(scenario);
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile, setSidebarOpen } = useSidebar();
  // Visiting an agent puts it in this story's recents.
  useEffect(() => {
    const ref = location.pathname.match(/\/chats\/([^/]+)/)?.[1];
    const agent = agents.find((a) => a.id === ref || agentRouteRef(a) === ref);
    if (agent) setRecent((ids) => [agent.id, ...ids.filter((id) => id !== agent.id)]);
  }, [location.pathname]);
  function choose(agent: Agent) {
    setOpen(false);
    if (isMobile) setSidebarOpen(false);
    navigate(`/chats/${agentRouteRef(agent)}`);
  }
  const openPicker = () => { setSearch(""); setOpen(true); };
  return <ReviewContext.Provider value={{ agents, recent, stars, openPicker, choose,
    toggleStar: (id) => setStars((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]),
  }}>
    {children}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined} className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <div className="flex flex-col gap-1 px-4 pt-4 pb-3">
          <DialogTitle>Chat with an agent</DialogTitle>
        </div>
        <Command>
          <CommandInput aria-label="Search agents by name or role" placeholder="Search by name or role…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>
              <div className="flex flex-col items-center gap-2 px-4">
                <span>No agents match “{search}”</span>
                <span className="text-xs text-muted-foreground">Try another name or role.</span>
                <Button variant="ghost" size="sm" onClick={() => setSearch("")}>Clear search</Button>
              </div>
            </CommandEmpty>
            <CommandGroup>
              {agents.map((agent) => <CommandItem key={agent.id} value={`${agent.id} ${agent.name} ${agent.title}`} onSelect={() => choose(agent)} className="gap-3 px-3 py-3">
                <AgentIcon icon={agent.icon} className="size-4 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">{agent.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{agent.title}</span>
                </span>
                {agent.status === "paused" && <span className="text-xs text-(--status-agent-paused)">Paused</span>}
              </CommandItem>)}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  </ReviewContext.Provider>;
}

export function ChatEntrySidebar() {
  const { agents, recent, stars, openPicker, toggleStar } = useReview();
  const { collapsed, peeking } = useSidebar();
  const rail = collapsed && !peeking;
  const firstAgent = [...agents].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id),
  )[0];
  const ordered = [
    ...agents.filter((a) => stars.includes(a.id)).sort((a, b) => a.name.localeCompare(b.name)),
    ...(firstAgent && !stars.includes(firstAgent.id) ? [firstAgent] : []),
    ...recent.filter((id) => !stars.includes(id) && id !== firstAgent?.id).slice(0, 4).flatMap((id) => agents.filter((a) => a.id === id)),
  ];
  return <section aria-label="Chats" className="group/chats flex flex-col gap-0.5">
    <div className="relative flex min-h-9 items-center px-4 py-1.5">
      <span className={cn("font-mono text-(length:--text-nano) font-medium uppercase tracking-widest text-muted-foreground/60", rail && "sr-only")}>Chats</span>
      <Button variant="ghost" size="icon-xs" aria-label="Chat with an agent" title="Chat with an agent" onClick={openPicker}
        className="absolute right-2 top-(--pct-50) -translate-y-(--pct-50) text-muted-foreground opacity-0 group-hover/chats:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100">
        <SquarePen className="size-3.5" />
      </Button>
    </div>
    {ordered.map((agent) => <div key={agent.id} className="group/chat-entry relative">
      <SidebarNavItem to={`/chats/${agentRouteRef(agent)}`} label={agent.name} iconNode={<AgentIcon icon={agent.icon} className="size-4" />} className={rail ? undefined : "pr-9"} />
      {!rail && <Button variant="ghost" size="icon-xs" aria-label={`${stars.includes(agent.id) ? "Unstar" : "Star"} ${agent.name}`} aria-pressed={stars.includes(agent.id)}
        onClick={() => toggleStar(agent.id)} className={cn("absolute right-2 top-(--pct-50) -translate-y-(--pct-50) text-muted-foreground opacity-0 group-hover/chat-entry:opacity-100 focus-visible:opacity-100", stars.includes(agent.id) && "opacity-100")}>
        <Star className={cn("size-3.5", stars.includes(agent.id) && "fill-current")} />
      </Button>}
    </div>)}
  </section>;
}

export function ChatEntryLanding() {
  const { agents, choose, openPicker } = useReview();
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => setBreadcrumbs([{ label: "Chats" }]), [setBreadcrumbs]);
  const suggestions = ["agent-cto", "agent-codex", "chat-design"].flatMap((id) => agents.filter((a) => a.id === id));
  return <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-16">
    <div className="flex flex-col gap-3">
      <MessageSquare className="size-6 text-muted-foreground" />
      <h1 className="text-xl font-semibold">Who would you like to talk to?</h1>
      <p className="text-sm text-muted-foreground">Think through an idea, ask a question, or plan the next step with someone on your team.</p>
    </div>
    <div className="flex flex-col gap-1">
      {suggestions.map((agent) => <Button key={agent.id} variant="ghost" className="h-auto justify-start gap-3 px-3 py-3" onClick={() => choose(agent)}>
        <AgentIcon icon={agent.icon} className="size-5" />
        <span className="flex flex-1 flex-col items-start gap-1"><span>{agent.name}</span><span className="text-xs font-normal text-muted-foreground">{agent.title}</span></span>
        <ArrowRight className="size-4 text-muted-foreground" />
      </Button>)}
    </div>
    <Button variant="outline" className="self-start" onClick={openPicker}><Search className="size-4" />Browse all {agents.length} agents</Button>
    <p className="text-xs text-muted-foreground">Your conversations will appear in Chats. Star the people you talk to most.</p>
  </div>;
}

export function ChatEntryConversation() {
  const { agents, openPicker } = useReview();
  const location = useLocation();
  const ref = location.pathname.split("/").at(-1);
  const agent = agents.find((a) => a.id === ref || agentRouteRef(a) === ref);
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    if (agent?.status === "paused") setBreadcrumbs([{ label: agent.name }]);
  }, [agent?.id, agent?.status, setBreadcrumbs]);
  if (agent?.status !== "paused") return <AgentChat />;
  return <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-16">
    <AgentIcon icon={agent.icon} className="size-6 text-muted-foreground" />
    <h1 className="text-xl font-semibold">{agent.name} is paused</h1>
    <p className="text-sm text-muted-foreground">This agent needs to be resumed before they can respond. Open their settings to review the pause, or talk to someone else.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" asChild><Link to={`/agents/${agentRouteRef(agent)}/runtime`}><Users className="size-4" />Open agent settings</Link></Button>
      <Button variant="ghost" onClick={openPicker}>Choose another agent</Button>
    </div>
  </div>;
}
