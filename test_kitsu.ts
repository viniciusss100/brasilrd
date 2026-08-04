import { KitsuMapper } from './src/catalogo/KitsuMapper.js';
async function run() {
    const mapper = KitsuMapper.getInstance();
    const res = await mapper.mapKitsuToImdb('kitsu:11:210');
    console.log('Result for kitsu:11:210 ->', res);
    
    const res2 = await mapper.mapKitsuToImdb('kitsu:11');
    console.log('Result for kitsu:11 ->', res2);
}
run().catch(console.error);
