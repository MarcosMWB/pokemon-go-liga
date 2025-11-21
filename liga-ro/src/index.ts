import { setGlobalOptions } from "firebase-functions";

// limita containers máximos pras functions desse codebase
setGlobalOptions({ maxInstances: 10 });

// Nenhuma function exportada aqui por enquanto.
// (arquivo "vazio" só pra não quebrar o build)
