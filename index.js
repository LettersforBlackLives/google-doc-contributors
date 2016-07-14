var Consts = {
  ClientID: '1053866203947-gc9nbfu9tgk5s995p8hikfv83mb66dgo.apps.googleusercontent.com',
  Scopes: [
    'https://www.googleapis.com/auth/drive.readonly',
  ],
};

var GoogleAPILoaded = false;
function onGoogleAPILoad() {
  console.log('Google API loaded');
  GoogleAPILoaded = true;
  if (window.VM) {
    window.VM.init();
  }
};

function incrementRevision(revision, counts) {
  if (!revision || !revision.lastModifyingUser) {
    return
  }

  var email = revision.lastModifyingUser.emailAddress;
  var name = revision.lastModifyingUser.displayName;
  var author = email || name;
  if (!author) {
    return
  }

  var entry = counts[author] || {email: email, name: name, count: 0};
  entry.count += 1;
  counts[author] = entry;
}

function incrementComment(comment, counts) {
  if (!comment || !comment.author) {
    return
  }

  var email = comment.author.emailAddress;
  var name = comment.author.displayName;
  var author = email || name;
  if (!author) {
    return
  }

  var entry = counts[author] || {email: email, name: name, count: 0};
  entry.count += 1;
  counts[author] = entry;
}

function VM() {
  // Use a msg to debug user issues
  this.userMsg = ko.observable('Initializing JS...');

  this.authed = ko.observable(false);
  this.needAuth = ko.observable(false);

  this.files = ko.observableArray();

  this.prevPageToken = ko.observable();
  this.currentPageToken = ko.observable();
  this.nextPageToken = ko.observable();

  this.file = ko.observable('');
  this.fileMsg = ko.observable('');

  this.revisors = ko.observableArray();
  this.commenters = ko.observableArray();
  this.contributors = ko.computed(function () {
    // Combine revisors & commenters

    var contributors = {};

    // Add commenters first, cuz we tend to have less info about them, so if
    // we add them first, we can look up by either name or email when we add
    // revisors.
    this.commenters().forEach(function (commenter) {
      // Favor email, but fall back to name
      contributors[commenter.email || commenter.name] = {
        email: commenter.email || '',
        name: commenter.name || '',
        revisions: 0,
        comments: commenter.count,
      };
    });

    this.revisors().forEach(function (revisor) {
      // Favor email, but fall back to name
      var key = (contributors[revisor.email] || !contributors[revisor.name]) ? revisor.email : revisor.name;
      if (!contributors[key]) {
        contributors[key] = {revisions: 0, comments: 0};
      }
      contributors[key].revisions += revisor.count;
      contributors[key].email = contributors[key].email || revisor.email;
      contributors[key].name = contributors[key].name || revisor.name;
    });

    var asArray = [];
    for (var key in contributors) {
      asArray.push(contributors[key]);
    }
    return asArray.sort(function (a, b) {
      return b.count - a.count;
    });
  }.bind(this));

  this.csv = ko.computed(function () {
    var csv = '#email,name,revisions,comments\n';
    this.contributors().forEach(function (contributor, index) {
      var row = (
          '' + contributor.email +
          ',' + contributor.name +
          ',' + contributor.revisions +
          ',' + contributor.comments +
          '\n');
      csv = csv + row;
    });
    return csv;
  }.bind(this));

  this.init = function () {
    // Check for user having just opened the file
    console.log('protocol:', window.location.protocol);
    if (window.location.protocol == 'file:') {
      this.userMsg('For this app to work, you need to run `python -m SimpleHTTPServer 8000` in terminal, then browse to http://localhost:8000');
      return
    }

    console.log('Checking auth');
    this.userMsg('Checking google drive auth...');
    gapi.auth.authorize(
      {
        'client_id': Consts.ClientID,
        'scope': Consts.Scopes.join(' '),
        'immediate': true
      },
      this.handleAuthResult);
  };

  this.handleAuthResult = function (authResult) {
    console.log(authResult);
    if (authResult && !authResult.error) {
      console.log('Already authed');

      this.authed(true);
      this.needAuth(false);

      this.userMsg('Getting list of files...');
      gapi.client.load('drive', 'v3', this.listFiles);
    } else {
      console.log('Need to get auth');

      this.authed(false);
      this.needAuth(true);
    }
  }.bind(this);

  this.handleAuthClick = function () {
    console.log('Authorizing');
    gapi.auth.authorize(
      {client_id: Consts.ClientID, scope: Consts.Scopes, immediate: false},
      this.handleAuthResult);
    return false;
  }.bind(this);

  this.listFiles = function () {
    console.log('Listing files. pageToken:', this.currentPageToken());

    gapi.client.drive.files.list({
      pageSize: 10,
      fields: 'nextPageToken, files(id, name)',
      pageToken: this.currentPageToken() || '',
    }).execute(function (reply) {
      console.log('Files reply:', reply);
      if (!reply || !reply.files) {
        this.userMsg('No files found');
        return
      }

      this.userMsg('');
      this.files(reply.files);
      this.nextPageToken(reply.nextPageToken);
    }.bind(this));
  }.bind(this);

  this.onFileChoose = function (file) {
    console.log('User chose file:', file);

    this.fileMsg('Checking file...');
    this.revisors.removeAll();
    this.file(file.name);

    this.getCommenters(file);

    gapi.client.drive.revisions.list({
      fileId: file.id,
      fields: 'revisions(id,lastModifyingUser)',
    }).execute(function (reply) {
      // User might have already switched files, so double check
      if (file.name != this.file()) {
        return
      }

      console.log('Revisions reply:', reply);
      if (!reply || reply.code || !reply.revisions) {
        this.fileMsg('Failed to get info about file: ' + reply.message);
        return
      }
      this.fileMsg('');

      var revisionCounts = {};
      reply.revisions.forEach(function (rev) {
        incrementRevision(rev, revisionCounts);
      });
      console.log('rev counts:', revisionCounts);

      for (var key in revisionCounts) {
        this.revisors.push(revisionCounts[key]);
      }
      this.revisors.sort(function (a, b) {
        return b.count - a.count;
      });
    }.bind(this));
  }.bind(this);

  this.handlePrevFiles = function () {
    this.nextPageToken(this.currentPageToken());
    this.currentPageToken(this.prevPageToken());
    this.prevPageToken(null);

    this.listFiles();
  }.bind(this);

  this.handleNextFiles = function () {
    this.prevPageToken(this.currentPageToken());
    this.currentPageToken(this.nextPageToken());
    this.nextPageToken(null);

    this.listFiles();
  }.bind(this);

  this.getCommenters = function (file, pageToken, commentersSoFar) {
    // User might have already switched files, so double check
    if (file.name != this.file()) {
      return
    }

    // On first call, clear old commenters
    if (!pageToken) {
      this.commenters.removeAll();
    }

    if (!commentersSoFar) {
      commentersSoFar = [];
    }

    gapi.client.drive.comments.list({
      fileId: file.id,
      fields: 'nextPageToken,comments(author(displayName,emailAddress),replies(author(displayName,emailAddress)))',
      includeDeleted: true,
      pageSize: 100,
      pageToken: pageToken,
    }).execute(function (reply) {
      // User might have already switched files, so double check
      if (file.name != this.file()) {
        return
      }

      console.log('Comments reply:', reply);
      if (!reply || reply.code || !reply.comments) {
        this.fileMsg('Failed to get comments for file: ' + reply.message);
        return
      }

      // Update commenter counts
      reply.comments.forEach(function (comment) {
        // Comment might have an author
        incrementComment(comment, commentersSoFar);

        // If comment has replies (single list, no sub-replies), then also
        // increment those authors
        comment.replies.forEach(function (reply) {
          incrementComment(reply, commentersSoFar);
        });
      });

      if (reply.nextPageToken) {
        // More to fetch
        this.getCommenters(file, reply.nextPageToken, commentersSoFar);
      } else {
        // Done iterating comments
        console.log('Commenters:', commentersSoFar);
        for (var author in commentersSoFar) {
          this.commenters.push(commentersSoFar[author]);
        }
        this.commenters.sort(function (a, b) {
          return b.count - a.count;
        });
      }
    }.bind(this));

  }.bind(this);
};

document.addEventListener("DOMContentLoaded", function(event) { 
  window.VM = new VM();
  ko.applyBindings(window.VM);

  if (window.GoogleAPILoaded) {
    window.VM.init();
  }
});
