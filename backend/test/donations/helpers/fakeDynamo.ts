import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { vi } from "vitest";
import { docClient } from "../../../src/shared/dynamo.js";

type Item = Record<string, unknown>;
type Values = Record<string, unknown>;
type Names = Record<string, string>;

interface TransactItem {
  Put?: { TableName: string; Item: Item; ConditionExpression?: string };
  Update?: {
    TableName: string;
    Key: Item;
    UpdateExpression: string;
    ConditionExpression?: string;
    ExpressionAttributeNames?: Names;
    ExpressionAttributeValues?: Values;
  };
}

const resolveName = (token: string, names: Names = {}) => names[token] ?? token;

/**
 * In-memory stand-in for the DynamoDB document client. It understands the small expression language the handlers
 * use (SET/ADD clauses; attribute_not_exists, =, < joined by AND/OR) and applies a transaction all or nothing.
 * The real semantics, concurrency included, are verified against DynamoDB Local in test/integration.
 */
export class FakeDynamo {
  readonly tables = new Map<string, Map<string, Item>>();
  readonly transactions: TransactItem[][] = [];

  private table(name: string): Map<string, Item> {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }

  private static keyOf(key: Item): string {
    return JSON.stringify(Object.entries(key).sort(([a], [b]) => a.localeCompare(b)));
  }

  get(tableName: string, key: Item): Item | undefined {
    return this.table(tableName).get(FakeDynamo.keyOf(key));
  }

  put(tableName: string, item: Item, keyNames: string[]): void {
    const key = Object.fromEntries(keyNames.map((name) => [name, item[name]]));
    this.table(tableName).set(FakeDynamo.keyOf(key), { ...item });
  }

  items(tableName: string): Item[] {
    return [...this.table(tableName).values()];
  }

  private static holds(condition: string | undefined, item: Item | undefined, names?: Names, values?: Values): boolean {
    if (!condition) return true;
    return condition
      .split(/\s+OR\s+/)
      .some((alternative) =>
        alternative.split(/\s+AND\s+/).every((term) => FakeDynamo.holdsTerm(term.trim(), item, names, values ?? {}))
      );
  }

  private static holdsTerm(term: string, item: Item | undefined, names: Names | undefined, values: Values): boolean {
    const notExists = /^attribute_not_exists\((.+)\)$/.exec(term);
    if (notExists) return item?.[resolveName(notExists[1], names)] === undefined;
    const exists = /^attribute_exists\((.+)\)$/.exec(term);
    if (exists) return item?.[resolveName(exists[1], names)] !== undefined;
    const comparison = /^(\S+)\s*(=|<)\s*(:\w+)$/.exec(term);
    if (!comparison) throw new Error(`FakeDynamo does not understand the condition term: ${term}`);
    const current = item?.[resolveName(comparison[1], names)];
    const expected = values[comparison[3]];
    if (current === undefined) return false;
    return comparison[2] === "=" ? current === expected : (current as number) < (expected as number);
  }

  private static applyUpdate(item: Item, expression: string, names: Names = {}, values: Values = {}): Item {
    const result = { ...item };
    for (const [, keyword, body] of expression.matchAll(/(SET|ADD)\s+(.+?)(?=\s+(?:SET|ADD)\s+|$)/g)) {
      for (const clause of body.split(",").map((part) => part.trim())) {
        if (keyword === "SET") {
          const [name, value] = clause.split(/\s*=\s*/);
          result[resolveName(name, names)] = values[value];
        } else {
          const [name, value] = clause.split(/\s+/);
          const attribute = resolveName(name, names);
          result[attribute] = ((result[attribute] as number | undefined) ?? 0) + (values[value] as number);
        }
      }
    }
    return result;
  }

  /** Cancellation reason codes (one per item, or undefined for no reasons) forced on the next transactions, in order. */
  private readonly forcedCancellations: Array<string[] | undefined> = [];
  /** Called before every transaction (for example to move a frozen clock). */
  onTransact: () => void = () => undefined;

  failNextTransactions(...cancellations: Array<string[] | undefined>): void {
    this.forcedCancellations.push(...cancellations);
  }

  private static cancelled(codes: string[] | undefined): Error {
    return Object.assign(new Error("Transaction cancelled"), {
      name: "TransactionCanceledException",
      ...(codes && { CancellationReasons: codes.map((Code) => ({ Code })) }),
    });
  }

  transact(items: TransactItem[]): void {
    this.transactions.push(items);
    this.onTransact();
    if (this.forcedCancellations.length > 0) throw FakeDynamo.cancelled(this.forcedCancellations.shift());
    const writes = items.map((entry) => this.prepare(entry));
    if (writes.some((write) => write === undefined)) {
      throw FakeDynamo.cancelled(writes.map((write) => (write ? "None" : "ConditionalCheckFailed")));
    }
    for (const write of writes) write!();
  }

  private prepare(entry: TransactItem): (() => void) | undefined {
    if (entry.Put) {
      const { TableName, Item: item, ConditionExpression } = entry.Put;
      const keyName = "pk" in item ? "pk" : "donationId";
      const current = this.get(TableName, { [keyName]: item[keyName] });
      if (!FakeDynamo.holds(ConditionExpression, current)) return undefined;
      return () => this.put(TableName, item, [keyName]);
    }
    const update = entry.Update!;
    const current = this.get(update.TableName, update.Key);
    const { ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues } = update;
    if (!FakeDynamo.holds(ConditionExpression, current, ExpressionAttributeNames, ExpressionAttributeValues)) {
      return undefined;
    }
    const next = FakeDynamo.applyUpdate(
      { ...update.Key, ...current },
      update.UpdateExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues
    );
    return () => this.put(update.TableName, next, Object.keys(update.Key));
  }

  /** Called before every single-item update (for example to let a concurrent writer change the item first). */
  onUpdate: () => void = () => undefined;
  /** Answers a Query; tests that need one provide it (the fake does not evaluate key conditions). */
  onQuery: (input: QueryCommand["input"]) => { Items?: Item[]; LastEvaluatedKey?: Item } = () => {
    throw new Error("FakeDynamo: this test does not expect a Query");
  };
  readonly updates: Array<NonNullable<TransactItem["Update"]>> = [];

  /** A single UpdateItem: applied when its condition holds, ConditionalCheckFailedException otherwise. */
  update(input: NonNullable<TransactItem["Update"]>): Item {
    this.updates.push(input);
    this.onUpdate();
    const write = this.prepare({ Update: input });
    if (!write) {
      throw Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" });
    }
    write();
    return this.get(input.TableName, input.Key)!;
  }

  /** Routes every docClient.send of the handlers to this fake. */
  install(): void {
    vi.spyOn(docClient, "send").mockImplementation((async (command: unknown) => {
      if (command instanceof GetCommand) {
        const { TableName, Key } = command.input;
        return { Item: this.get(TableName!, Key!) };
      }
      if (command instanceof TransactWriteCommand) {
        this.transact(command.input.TransactItems as TransactItem[]);
        return {};
      }
      if (command instanceof UpdateCommand) {
        const updated = this.update(command.input as NonNullable<TransactItem["Update"]>);
        return command.input.ReturnValues === "ALL_NEW" ? { Attributes: updated } : {};
      }
      if (command instanceof QueryCommand) return this.onQuery(command.input);
      if (command instanceof PutCommand) return {};
      throw new Error(`FakeDynamo does not support ${String((command as object).constructor.name)}`);
    }) as never);
  }
}
