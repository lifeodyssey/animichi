/**
 * oRPC's official `SmartCoercionPlugin` (`@orpc/json-schema`), applied to GET procedures only.
 *
 * A GET procedure's input is its path and query, and both arrive as text: without coercion
 * `GET /catalog/public/popular?limit=8` reaches `PopularInput`'s `z.number()` as the string "8" and
 * answers 400. The plugin converts each value to the type the procedure's input schema declares,
 * reading the schema through the converter it is given.
 *
 * The plugin does that to every procedure that has an input schema, wherever the input came from:
 * its `init` registers a client interceptor that hands the whole input to its coercer. A POST
 * procedure's input is its JSON body, which already carries its types, so the unscoped plugin would
 * turn a number sent as the string "8" into 8 and accept a body the contract refuses. Here the
 * official plugin registers its interceptors on options of their own, and each one is installed
 * behind a check of the procedure's route method: a GET procedure is coerced, and every other
 * procedure reaches validation with the input it was sent. A route that declares no method is a
 * POST, oRPC's default, so only a declared GET is coerced.
 */
import type { SmartCoercionPlugin } from "@orpc/json-schema";
import type { Context } from "@orpc/server";
import type { StandardHandlerOptions, StandardHandlerPlugin } from "@orpc/server/standard";

/** An interceptor around a procedure's call, the kind the coercion plugin registers. */
type ClientInterceptor<T extends Context> = NonNullable<StandardHandlerOptions<T>["clientInterceptors"]>[number];

/** The official coercion plugin, installed for GET procedures only. */
export class GetProcedureCoercion<T extends Context> implements StandardHandlerPlugin<T> {
  readonly #coercion: SmartCoercionPlugin<T>;

  constructor(coercion: SmartCoercionPlugin<T>) {
    this.#coercion = coercion;
  }

  init(options: StandardHandlerOptions<T>): void {
    const registered: ClientInterceptor<T>[] = [];
    this.#coercion.init({ clientInterceptors: registered });
    options.clientInterceptors ??= [];
    options.clientInterceptors.unshift(...registered.map(forGetProcedures));
  }
}

/** `interceptor` around a GET procedure's call; any other procedure goes on with its input untouched. */
function forGetProcedures<T extends Context>(interceptor: ClientInterceptor<T>): ClientInterceptor<T> {
  return (call) => (call.procedure["~orpc"].route.method === "GET" ? interceptor(call) : call.next());
}
