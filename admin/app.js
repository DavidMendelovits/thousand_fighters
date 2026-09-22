import {WorkbenchSession} from './WorkbenchSession.js';
import {mountWorkbenchApplication} from './workbenchApplication.js';

const session = new WorkbenchSession(window);
session.start(mountWorkbenchApplication);
// BFCache freezes this document and restores it intact. Keep its controller
// alive for a persisted page; dispose only when the document really exits.
session.listen(window, 'pagehide', event => {if(!event.persisted)session.dispose();});
