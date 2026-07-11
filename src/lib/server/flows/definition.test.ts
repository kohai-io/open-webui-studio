import { describe, expect, it } from 'vitest';
import { FLOW_MAX_NODES, FlowDefinitionError, validateFlowDefinition } from './definition';
import { validFlowDefinition } from './fixtures';

describe('validateFlowDefinition', () => {
	it('normalises the supported text DAG and preserves editor positions', () => {
		const definition = validFlowDefinition();
		expect(validateFlowDefinition(structuredClone(definition))).toEqual(definition);
	});

	it.each(['conditional', 'merge', 'loop', 'knowledge', 'websearch', 'file', 'tool'])(
		'rejects the deferred %s node type',
		(type) => {
			const definition = validFlowDefinition() as unknown as {
				nodes: Array<Record<string, unknown>>;
			};
			definition.nodes[1].type = type;
			expectIssues(definition, [{ path: '$.nodes[1].type', code: 'unsupported_node' }]);
		}
	);

	it('rejects unknown fields and secret material instead of retaining them', () => {
		const definition = validFlowDefinition() as unknown as {
			nodes: Array<{ config: Record<string, unknown> }>;
		};
		definition.nodes[0].config = {
			key: 'request',
			defaultValue: 'Bearer abc.def.ghi',
			accessToken: 'hidden'
		};
		expectIssues(definition, [
			{ path: '$.nodes[0].config.accessToken', code: 'unknown_field' },
			{ path: '$.nodes[0].config.defaultValue', code: 'forbidden_value' }
		]);
	});

	it('rejects cycles, duplicate edges, missing references, and disconnected nodes', () => {
		const cycle = validFlowDefinition();
		cycle.edges.push({ id: 'edge4', source: 'transform1', target: 'model1' });
		expectIssueCode(cycle, 'invalid_graph');

		const duplicate = validFlowDefinition();
		duplicate.edges.push({ id: 'edge4', source: 'input1', target: 'model1' });
		expectIssueCode(duplicate, 'duplicate');

		const missing = validFlowDefinition();
		missing.edges[0].source = 'missing';
		expectIssueCode(missing, 'invalid_reference');

		const disconnected = validFlowDefinition();
		disconnected.edges.splice(1, 1);
		expectIssueCode(disconnected, 'invalid_graph');
	});

	it('requires template references to name an upstream node', () => {
		const forward = validFlowDefinition();
		const model = forward.nodes[1];
		if (model.type !== 'model') throw new Error('fixture mismatch');
		model.config.prompt = 'Use {{node.transform1.output}}';
		expectIssueCode(forward, 'invalid_reference');

		const malformed = validFlowDefinition();
		const malformedModel = malformed.nodes[1];
		if (malformedModel.type !== 'model') throw new Error('fixture mismatch');
		malformedModel.config.prompt = 'Use {{input1}}';
		expectIssueCode(malformed, 'invalid_reference');

		const unmatched = validFlowDefinition();
		const unmatchedModel = unmatched.nodes[1];
		if (unmatchedModel.type !== 'model') throw new Error('fixture mismatch');
		unmatchedModel.config.prompt = 'Use {{node.input1.output';
		expectIssueCode(unmatched, 'invalid_reference');
	});

	it('rejects ambiguous fan-in for transforms and outputs without merge semantics', () => {
		const transformFanIn = validFlowDefinition();
		transformFanIn.nodes.unshift({
			id: 'input2',
			type: 'input',
			position: { x: 0, y: 120 },
			config: { key: 'second' }
		});
		transformFanIn.edges.push({ id: 'edge4', source: 'input2', target: 'transform1' });
		expectIssueCode(transformFanIn, 'invalid_graph');

		const outputFanIn = validFlowDefinition();
		outputFanIn.edges.push({ id: 'edge4', source: 'model1', target: 'output1' });
		expectIssueCode(outputFanIn, 'invalid_graph');
	});

	it('rejects duplicate input keys and URL-shaped model identifiers', () => {
		const duplicateInput = validFlowDefinition();
		duplicateInput.nodes.splice(1, 0, {
			id: 'input2',
			type: 'input',
			position: { x: 0, y: 120 },
			config: { key: 'request' }
		});
		duplicateInput.edges.unshift({ id: 'edge0', source: 'input2', target: 'model1' });
		expectIssueCode(duplicateInput, 'duplicate');

		const modelUrl = validFlowDefinition();
		const model = modelUrl.nodes[1];
		if (model.type !== 'model') throw new Error('fixture mismatch');
		model.config.modelId = 'https://provider.invalid/model';
		expectIssueCode(modelUrl, 'forbidden_value');
	});

	it('rejects values that cannot form a JSON definition', () => {
		expectIssues(undefined, [{ path: '$', code: 'invalid_type' }]);
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expectIssues(cyclic, [{ path: '$', code: 'invalid_type' }]);
	});

	it('enforces node limits and exact schema versions', () => {
		const tooMany = validFlowDefinition();
		tooMany.nodes = Array.from({ length: FLOW_MAX_NODES + 1 }, (_, index) => ({
			id: `input${index}`,
			type: 'input' as const,
			position: { x: index, y: 0 },
			config: { key: `key${index}` }
		}));
		expectIssueCode(tooMany, 'too_many');

		const wrongVersion = { ...validFlowDefinition(), schemaVersion: 2 };
		expectIssues(wrongVersion, [{ path: '$.schemaVersion', code: 'invalid_value' }]);
	});
});

function expectIssueCode(value: unknown, code: string) {
	try {
		validateFlowDefinition(value);
		throw new Error('expected validation to fail');
	} catch (error) {
		expect(error).toBeInstanceOf(FlowDefinitionError);
		expect((error as FlowDefinitionError).issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code })])
		);
	}
}

function expectIssues(value: unknown, issues: Array<{ path: string; code: string }>) {
	try {
		validateFlowDefinition(value);
		throw new Error('expected validation to fail');
	} catch (error) {
		expect(error).toBeInstanceOf(FlowDefinitionError);
		expect((error as FlowDefinitionError).issues).toEqual(
			expect.arrayContaining(issues.map((issue) => expect.objectContaining(issue)))
		);
	}
}
