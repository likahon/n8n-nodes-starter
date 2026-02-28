import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export class GithubIssues implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'GitHub Issues',
        name: 'githubIssues',
        icon: 'file:githubIssues.svg',
        group: ['input'],
        version: 1,
        description: 'Consume issues from the GitHub API',
        defaults: {
            name: 'GitHub Issues',
        },
        inputs: [NodeConnectionTypes.Main],
        outputs: [NodeConnectionTypes.Main],
        properties: [
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            
            // Tu lógica aquí
            
            returnData.push({
                json: item.json,
            });
        }

        return [returnData];
    }
}