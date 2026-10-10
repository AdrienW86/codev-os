import { InlineNotice } from "@/components/ui/states";

/** Affiché quand la lecture d'un module échoue (migration non appliquée ou panne passagère). */
export function ModuleUnavailable({ module }: { module: string }) {
  return (
    <InlineNotice tone="amber" title={`${module} : données indisponibles.`}>
      La lecture a échoué. Si la migration <code>20261015000000_codev_os_core.sql</code> n’est pas encore appliquée, suivez docs/setup.md ; sinon réessayez dans quelques instants. Aucune donnée n’a été modifiée.
    </InlineNotice>
  );
}
