import { Link } from "react-router-dom";

export function ProjectWorkspaceLinks({ projectId }: { projectId: string }) {
  const query = `?project=${encodeURIComponent(projectId)}`;
  return <nav aria-label="Project workspaces" className="flex flex-wrap items-center gap-3 text-xs font-semibold text-cyan-300">
    <Link className="hover:text-cyan-100" to={`/engineering${query}`}>Engineering</Link>
    <Link className="hover:text-cyan-100" to={`/exchange${query}`}>BIM / civil exchange</Link>
    <Link className="hover:text-cyan-100" to={`/geometry${query}`}>Geometry / rendering</Link>
  </nav>;
}
