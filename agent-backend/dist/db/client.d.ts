import pg from "pg";
export declare const pool: pg.Pool | null;
export declare const query: (text: string, params?: any[]) => Promise<pg.QueryResult<any> | {
    rows: never[];
    rowCount: number;
}>;
//# sourceMappingURL=client.d.ts.map