/** Bounded LRU resources. Leases protect geometry used by live/export scenes. */
export class ResourceCache {
    constructor(limit, dispose) { this.limit=limit; this.dispose=dispose; this.entries=new Map(); }
    acquire(key, create) {
        let entry=this.entries.get(key);
        if(!entry) entry={value:create(),users:0};
        this.entries.delete(key); this.entries.set(key,entry); entry.users++;
        this.trim();
        let released=false;
        return {value:entry.value,release:()=>{
            if(released) return;
            released=true; entry.users--;
            if(entry.users===0 && entry.retired) { this.dispose(entry.value); }
            this.trim();
        }};
    }
    trim() {
        for(const [key,entry] of this.entries) {
            if(this.entries.size<=this.limit) break;
            if(entry.users===0) { this.entries.delete(key); this.dispose(entry.value); }
        }
    }
    clear() {
        for(const [key,entry] of this.entries) {
            this.entries.delete(key);
            if(entry.users===0) this.dispose(entry.value);
            else entry.retired=true;
        }
    }
}
