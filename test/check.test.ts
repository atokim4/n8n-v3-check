import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { checkWorkflow, REMOVED_NODES, worstSeverity, type Workflow } from '../src/index.js';

const fixture = async (name: string): Promise<Workflow> =>
  JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Workflow;

const byNode = (findings: ReturnType<typeof checkWorkflow>) =>
  Object.fromEntries(findings.map((f) => [`${f.nodeName}|${f.ruleId}`, f]));

describe('checkWorkflow', () => {
  it('reports nothing for a workflow that only uses current nodes', async () => {
    expect(checkWorkflow(await fixture('clean.json'))).toEqual([]);
  });

  it('flags every removed node in a multi-node workflow with its replacement', async () => {
    const findings = byNode(checkWorkflow(await fixture('legacy-multi.json')));
    expect(findings['Cron|cron-removed-v3']).toMatchObject({ severity: 'error', autoMigratable: true });
    expect(findings['Cron|cron-removed-v3']?.fix).toContain('Schedule Trigger');
    expect(findings['Function|function-removed-v3']).toMatchObject({ severity: 'error', autoMigratable: false });
    expect(findings['Function|function-removed-v3']?.fix).toContain('Run Once for All Items');
    expect(findings['Item Lists|item-lists-removed-v3']?.severity).toBe('error');
  });

  it('includes disabled nodes like n8n does, marks them, and can skip them', async () => {
    const wf = await fixture('legacy-multi.json');
    const disabled = checkWorkflow(wf).find((f) => f.nodeName === 'Old Function Item');
    expect(disabled).toMatchObject({ ruleId: 'function-item-removed-v3', disabled: true });
    expect(checkWorkflow(wf, { ignoreDisabled: true }).some((f) => f.nodeName === 'Old Function Item')).toBe(false);
  });

  it('ignores sticky notes but catches $getPairedItem in real expressions', async () => {
    const findings = checkWorkflow(await fixture('legacy-multi.json'));
    expect(findings.some((f) => f.nodeName === 'Note')).toBe(false);
    expect(findings.find((f) => f.nodeName === 'Set')?.ruleId).toBe('get-paired-item-v3');
  });

  it('flags Always Output Data only on nodes with several outputs', async () => {
    const findings = checkWorkflow(await fixture('legacy-multi.json'));
    expect(findings.find((f) => f.nodeName === 'If')?.ruleId).toBe('always-output-data-multi-output-v3');
    expect(findings.some((f) => f.nodeName === 'HTTP')).toBe(false);
  });

  it('resolves AI Agent v1 modes the way n8n does', async () => {
    const findings = byNode(checkWorkflow(await fixture('ai-agent.json')));
    // Up to v1.5 an unset mode meant Conversational Agent, which is removed.
    expect(findings['Agent conversational|agent-removed-modes-v3']?.severity).toBe('error');
    // From v1.6 an unset mode is Tools Agent: keeps working with v2 behaviour.
    expect(findings['Agent tools|agent-node-version-v3']?.severity).toBe('warning');
    expect(findings['Agent explicit sql|agent-removed-modes-v3']?.message).toContain('SQL Agent');
    expect(Object.keys(findings).some((k) => k.startsWith('Agent new|'))).toBe(false);
    expect(findings['SerpAPI|serpapi-google-search-removed-v3']?.severity).toBe('error');
    expect(findings['Manual Chat|manual-chat-trigger-removed-v3']?.severity).toBe('error');
    expect(findings['Chat|chat-trigger-embedded-json-v3']?.severity).toBe('warning');
  });

  it('handles community nodes and version-specific rules', async () => {
    const findings = byNode(checkWorkflow(await fixture('community.json')));
    expect(findings['Serp community|unverified-packages-v3']?.severity).toBe('info');
    expect(findings['Scoped community|unverified-packages-v3']?.severity).toBe('info');
    expect(findings['Serp community|serpapi-google-search-removed-v3']).toBeUndefined();
    expect(findings['Gmail Trigger old|gmail-trigger-version-v3']?.severity).toBe('warning');
    expect(Object.keys(findings).some((k) => k.startsWith('Gmail Trigger new|'))).toBe(false);
    expect(findings['Edit Image|edit-image-version-v3']?.severity).toBe('error');
    expect(findings['Sub|execute-workflow-source-modes-v3']?.message).toContain('URL');
    expect(findings['Code eval|evaluate-expression-code-node-v3']?.severity).toBe('error');
    expect(Object.keys(findings).some((k) => k.startsWith('Code python|'))).toBe(false);
    expect(findings['Slack|slack-trigger-signature-secret-v3']?.severity).toBe('info');
  });

  it('treats a missing typeVersion as version 1', () => {
    const findings = checkWorkflow({ nodes: [{ name: 'Img', type: 'n8n-nodes-base.editImage' }] });
    expect(findings[0]?.ruleId).toBe('edit-image-version-v3');
  });
});

describe('rule table', () => {
  it('has one entry per node type and rule id', () => {
    expect(new Set(REMOVED_NODES.map((r) => r.type)).size).toBe(REMOVED_NODES.length);
    expect(new Set(REMOVED_NODES.map((r) => r.ruleId)).size).toBe(REMOVED_NODES.length);
  });
});

describe('worstSeverity', () => {
  it('picks the most severe level', async () => {
    expect(worstSeverity(checkWorkflow(await fixture('legacy-multi.json')))).toBe('error');
    expect(worstSeverity([])).toBeUndefined();
  });
});
