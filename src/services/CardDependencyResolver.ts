export class CardDependencyResolver {
    /**
     * Extract card references from MBQL query
     */
    static extractCardReferences(datasetQuery: any): number[] {
        const cardRefs: Set<number> = new Set();

        function traverse(obj: any) {
            if (!obj) return;

            if (typeof obj === 'string' && obj.startsWith('card__')) {
                const cardId = parseInt(obj.replace('card__', ''), 10);
                if (!isNaN(cardId)) {
                    cardRefs.add(cardId);
                }
            }

            if (typeof obj === 'object') {
                if (Array.isArray(obj)) {
                    obj.forEach(traverse);
                } else {
                    Object.values(obj).forEach(traverse);
                }
            }
        }

        traverse(datasetQuery);
        return Array.from(cardRefs);
    }

    /**
     * Sort cards by dependency order (simple: lowest ID first)
     * More complex: build actual dependency graph if needed
     */
    static sortByDependencies(cards: any[]): any[] {
        // Simple approach: sort by card ID (lowest first)
        // This assumes lower IDs were created first and are dependencies
        return cards.sort((a, b) => a.id - b.id);
    }

    /**
     * Build full dependency graph
     */
    static buildDependencyGraph(cards: any[]): Map<number, number[]> {
        const graph = new Map<number, number[]>();

        for (const card of cards) {
            const deps = this.extractCardReferences(card.dataset_query);
            graph.set(card.id, deps);
        }

        return graph;
    }
    /**
     * Build reverse dependency graph (Provider -> Consumers)
     */
    static buildReverseDependencyGraph(cards: any[]): Map<number, number[]> {
        const reverseGraph = new Map<number, number[]>();

        // Initialize empty arrays
        cards.forEach(c => reverseGraph.set(c.id, []));

        for (const card of cards) {
            const deps = this.extractCardReferences(card.dataset_query);
            for (const depId of deps) {
                if (!reverseGraph.has(depId)) {
                    reverseGraph.set(depId, []);
                }
                reverseGraph.get(depId)!.push(card.id);
            }
        }

        return reverseGraph;
    }
}
