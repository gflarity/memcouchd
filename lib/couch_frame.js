var PubSub = require('./pubsub');
var Design = require('./design');

function CouchFrame( store ) {
    this._databases = {};

    this._start_time = new Date().getTime();

    this.store = store;


};
exports.CouchFrame = CouchFrame;

CouchFrame.prototype._ifNameValid = function(name, cb) {

    if (this.RE_VALID_DB_NAMES.test(name) === false) {
	return { "error":"illegal_database_name","reason":"Only lowercase characters (a-z), digits (0-9), and any of the characters _, $, (, ), +, -, and / are allowed. Must begin with a letter."};
    }


    return cb.call(this);
};


CouchFrame.prototype._ifDBExists = function(name, cb) {
    //TODO clean up nested call backs
    var that = this;
    return this._ifNameValid(name, function() {
            var db = that._databases[name];
            if (!db) {
                return { error: 'not_found', reason: 'no_db_file' };
            }
            return cb.call( this, db);
        });
};

CouchFrame.prototype.allDbs = function() {
    var dbs = [];
    for (var db in this._databases) {
	dbs.push(this._databases[db].name);
    };
    return dbs;
};

CouchFrame.prototype.dbGet = function(name, cb) {
    return this._ifDBExists(name, cb);
};


CouchFrame.prototype.dbInfo = function(name) {
    return this._ifDBExists(name, function(db) {
	    return {
		db_name: name,
		doc_count: db.docs.size(),
		disk_size: 0,
		update_seq: db.update_seq,
		committed_update_seq: db.update_seq
	    };
	});
};


CouchFrame.prototype.dbCreate = function(name) {
    return this._ifNameValid(name, function() {
	    var db = this._databases[name];
	    if (db) {
		return { error: 'file_exists', reason: 'The database could not be created, the file already exists.' };
	    }

	    //TODO this should be clean and consistent
	    this._databases[name] = {
		name: name,		
		docs: this.store.create(),
		design: {},
		update_seq: 0,
		pubsub: PubSub.create()
	    };
	    
	    return { ok: true };
	});
};


CouchFrame.prototype.dbDelete = function(name) {
    return this._ifDBExists(name, function(db) {
	    db.pubsub.destroy();
	    delete this._databases[name];
	    return { ok: true };
	});
};

CouchFrame.prototype.dbGetDoc = function(name, docid, query) {
    query = query || {};
    return this._ifDBExists(name, function(db) {
	    var doc = db.docs.find(docid);
	    if (doc) {
		// TODO: This is a hack, we should really be storing
		// a meta-doc in the store so that we can have these
		// other attributes associated with the doc.
		delete doc._revs_info;
		delete doc._local_seq;
		delete doc._conflicts;
		if (query.revs_info === 'true') {
		    doc._revs_info = [ { status: 'available', rev: doc._rev } ];
		} else if (query.local_seq === 'true') {
		    doc._local_seq = 1;
		} else if (query.conflicts === 'true') {
		    doc._conflicts = [];
		}
	    }
	    return doc || { error: 'not_found', reason: 'missing' };
	});
};


CouchFrame.prototype.dbPutDoc = function(name, docid, doc) {
    if (!doc) {
	return { error: 'bad_request', reason: 'invalid UTF-8 JSON' };
    }

    var that = this;

    doc._id = docid || doc._id || this._createUUID();
    return this._ifDBExists(name, function(db) {
	    return db.docs.insert2(doc._id, function(_doc, insertcb) {
                    if (_doc) {
                        if (_doc._rev !== doc._rev) {
                            return { error: 'conflict', reason: 'document update conflict' };
                        }
			
                        doc._rev = [ parseInt(doc._rev.split('-')[0], 10) + 1, that._createUUID() ].join('-');
                    } else {
                        doc._rev = '1-' + that._createUUID();
                    }
		    
                    insertcb(doc);
                    db.update_seq += 1;
		    
                    if (that.RE_DESIGN_DOC.test(doc._id)) {
                        var name = RegExp.$1;
                        db.design[name] = Design.create(db.docs, doc);
                    } else {
                        var n;
                        for (n in db.design) {
                            if (db.design.hasOwnProperty(n)) {
                                db.design[n].update(doc);
                            }
                        }
                    }
		    
                    db.pubsub.publish(function(sub) {
			    return { seq: db.update_seq, id: doc._id };
			});
                    return { ok: true, id: doc._id, rev: doc._rev };
                });
	});
};


CouchFrame.prototype.dbDeleteDoc = function(name, docid, rev) {

    //TODO throw createUUID into utils module, this is getting silly
    //TODO cleanup nested functions
    var that = this;
    return this._ifDBExists(name, function(db) {
	    return db.docs.erase2(docid, function(_doc, erasecb) {
                    if (_doc) {
                        if (_doc._rev !== rev) {
                            return { error: 'conflict', reason: 'document update conflict' };
                        }
			
                        _doc._rev = [ parseInt(_doc._rev.split('-')[0], 10) + 1, that._createUUID() ].join('-');
			
                        erasecb();
                        db.update_seq += 1;
			
                        if (that.RE_DESIGN_DOC.test(docid)) {
                            var name = RegExp.$1;
                            delete db.design[name];
                        } else {
                            var n;
                            for (n in db.design) {
                                if (db.design.hasOwnProperty(n)) {
                                    db.design[n].erase(_doc);
                                }
                            }
                        }
			
                        db.pubsub.publish(function(sub) {
				return { seq: db.update_seq, id: _doc._id, deleted: true };
			    });
                        return { ok: true, id: _doc._id, rev: _doc._rev };
                    } else {
                        return { error: 'not_found', reason: 'missing' };
                    }
                });
	});
};


CouchFrame.prototype.dbGetDocs - function(name, keys, cb) {
    if (Collate.type(keys) !== Collate._Array) {
	return { error: 'bad_request', reason: '`keys` member must be a array.' };
    }
    
    return this._ifDBExists(name, function(db) {
	    keys.forEach(function(key) {
                    var doc = db.docs.findFirst(key);
                    if (doc) { cb({ id: key, key: key, value: doc }); }
                });
	    return { total_rows: db.docs.size() };
	});
};


CouchFrame.prototype.dbAllDocs = function(name, opts, cb) {
    return this._ifDBExists(name, function(db) {
	    return db.docs.each(opts, function(key, val) {
		    cb({ id: key, key: key, value: val });
                });
	});
};

CouchFrame.prototype.dbBulkDocs = function(name, docs) {
    var self = this;
    return this._ifDBExists(name, function(db) {
	    var result = [];
	    // TODO: This causes extra db name lookups + validation
	    // Refactor so the db has these API's directly
	    docs.forEach(function(doc) {
                    if (doc._deleted) {
                        result.push(self.dbDeleteDoc(name, doc._id, doc._rev));
                    } else {
                        result.push(self.dbPutDoc(name, doc._id, doc));
                    }
                });
	    return result;
	});
};


CouchFrame.prototype.dbView = function(name, design, view, opts, cb) {
    return this._ifDBExists(name, function(db) {
	    var _design = db.design[design];
	    var _view = _design ? _design.view(view) : undefined;
	    if (_view === undefined) {
		return { error: 'not_found', reason: 'missing' };
	    }
	    
	    return _view.each(opts, cb);
	});
};


CouchFrame.prototype.dbTempView = function(name, doc, opts, cb) {
    return this._ifDBExists(name, function(db) {
	    var d, view = View.create('temp', doc);
	    
	    db.docs.each(function(_, d) { view.update(d); });
	    return view.each(opts, cb);
	});
};


CouchFrame.prototype.dbSubscribe  = function(name, opts, req, updatecb, finishcb) {
    return this._ifDBExists(name, function(db) {
	    return db.pubsub.subscribe(opts, req, updatecb, finishcb);
	});
};
  

CouchFrame.prototype.dbUnsubscribe = function(name, sub) {
    return this._ifDBExists(name, function(db) {
	    return db.pubsub.unsubscribe(sub);
	})
};

CouchFrame.prototype.RE_VALID_DB_NAMES = /^[a-z][a-z0-9_\$\(\)+\-\/]+$/;
CouchFrame.prototype.RE_DESIGN_DOC = /^_design\/(.*)$/;

// From: https://github.com/broofa/node-uuid
//TODO throw this into a util module or something
CouchFrame.prototype._createUUID = (function() {
        var hex = [
		   '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
		   'a', 'b', 'c', 'd', 'e', 'f'
		   ];
        return function() {
            var b = [], i = 0, r, v;

            r = Math.random() * 0x100000000;
            v = r & 0xff;
            b[i++] = hex[(v >>> 4) & 0x0f];
            b[i++] = hex[v & 0x0f];
            v = (r = r >>> 8) & 0xff;
            b[i++] = hex[(v >>> 4) & 0x0f];
            b[i++] = hex[v & 0x0f];
            v = (r = r >>> 8) & 0xff;
            b[i++] = hex[(v >>> 4) & 0x0f];
            b[i++] = hex[v & 0x0f];
            v = (r = r >>> 8) & 0xff;
            b[i++] = hex[(v >>> 4) & 0x0f];
            b[i++] = hex[v & 0x0f];

            r = Math.random() * 0x100000000;
            v = r & 0xff;
            b[i++] = hex[(v >>> 4) & 0x0f];
            b[i++] = hex[v & 0x0f];
            v = (r = r >>> 8) & 0xff;
            b[i++] = hex[(v >>> 4) & 0x0f];
            b[i++] = hex[v & 0x0f];
            v = (r = r >>> 8) & 0xff;
            b[i++] = hex[0x4];
            b[i++] = hex[v & 0x0f];
            v = (r = r >>> 8) & 0xff;
            b[i++] = hex[(v >>> 4) & 0x0f];
            b[i++] = hex[v & 0x0f];
	    
            r = Math.random() * 0x100000000;
            v = r & 0x3f | 0x80;
            b[i++] = hex[(v >>> 4) & 0x0f];
            b[i++] = hex[v & 0x0f];
            v = (r = r >>> 8) & 0xff;
            b[i++] = hex[(v >>> 4) & 0x0f];
            b[i++] = hex[v & 0x0f];
            v = (r = r >>> 8) & 0xff;
            b[i++] = hex[(v >>> 4) & 0x0f];
            b[i++] = hex[v & 0x0f];
            v = (r = r >>> 8) & 0xff;
            b[i++] = hex[(v >>> 4) & 0x0f];
            b[i++] = hex[v & 0x0f];
	    
            r = Math.random() * 0x100000000;
            v = r & 0xff;
            b[i++] = hex[(v >>> 4) & 0x0f];
            b[i++] = hex[v & 0x0f];
            v = (r = r >>> 8) & 0xff;
            b[i++] = hex[(v >>> 4) & 0x0f];
            b[i++] = hex[v & 0x0f];
            v = (r = r >>> 8) & 0xff;
            b[i++] = hex[(v >>> 4) & 0x0f];
            b[i++] = hex[v & 0x0f];
            v = (r = r >>> 8) & 0xff;
            b[i++] = hex[(v >>> 4) & 0x0f];
            b[i++] = hex[v & 0x0f];
            return b.join('');
        };
    }());

CouchFrame.prototype.uuid = function() {
    return this._createUUID();
};
