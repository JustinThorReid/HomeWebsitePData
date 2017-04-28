module.exports = {
    "version": 1,

    // Column names and types as supported by MongoosJS
    "columns": {
	lat: {
	    type: Number,
	    required: true
	},
	lng: {
	    type: Number,
	    required: true
	},
	name: {
	    type: String
	},
	description: {
	    type: String
	}
    },
    
    // Update all data from <version> to the latest version
    "upgrade": function (data, version) {
    },

    // Any supported 'extra' options such as disabling updatedAt or createdAt
    "extraOptions": {
	//updatedAt: false
    }
}
