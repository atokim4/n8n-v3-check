import { worstSeverity } from './check.js';
import type { Finding, Severity, WorkflowReport } from './types.js';

export interface Summary {
  workflows: number;
  affected: number;
  errors: number;
  warnings: number;
  infos: number;
}

export function summarize(reports: readonly WorkflowReport[]): Summary {
  const count = (s: Severity) => reports.reduce((n, r) => n + r.findings.filter((f) => f.severity === s).length, 0);
  return {
    workflows: reports.length,
    affected: reports.filter((r) => worstSeverity(r.findings) === 'error' || worstSeverity(r.findings) === 'warning').length,
    errors: count('error'),
    warnings: count('warning'),
    infos: count('info'),
  };
}

const LABEL: Record<Severity, string> = { error: 'BREAKS', warning: 'CHANGES', info: 'CHECK' };

function formatFinding(f: Finding): string {
  const version = f.typeVersion === undefined ? '' : ` v${f.typeVersion}`;
  const flags = [f.disabled ? 'disabled' : '', f.autoMigratable ? 'Migration Report offers auto-migration' : '']
    .filter(Boolean)
    .join(', ');
  return [
    `  ${LABEL[f.severity].padEnd(7)} "${f.nodeName}" (${f.nodeType}${version})${flags ? ` [${flags}]` : ''}`,
    `          ${f.message}`,
    `          fix: ${f.fix}`,
  ].join('\n');
}

export function formatText(reports: readonly WorkflowReport[], options: { showInfo: boolean }): string {
  const lines: string[] = [];
  for (const report of reports) {
    const findings = report.findings.filter((f) => options.showInfo || f.severity !== 'info');
    if (findings.length === 0) continue;
    lines.push(`${report.workflowName}  (${report.source})`);
    for (const f of findings) lines.push(formatFinding(f));
    lines.push('');
  }
  const s = summarize(reports);
  lines.push(
    `${s.workflows} workflow(s) checked: ${s.affected} affected, ` +
      `${s.errors} breaking, ${s.warnings} behaviour change(s), ${s.infos} to check by hand` +
      (s.infos > 0 && !options.showInfo ? ' (list them with --show-info).' : '.'),
  );
  return lines.join('\n');
}
