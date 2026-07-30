;;; pubstatic-ox.el --- Org export hooks for pubstatic blog  -*- lexical-binding: t; -*-

;; Inject <meta name="keywords"> into HTML export based on FILETAGS so
;; pubstatic's watcher can extract tags from Org-exported HTML files.  When a
;; post opts in with #+PUBSTATIC_ATTACHMENTS: copy, local file links are copied
;; to Pubstatic's public directory and rewritten to its static URL.

;;; Usage:
;;   (require 'pubstatic-ox)
;;   (pubstatic-ox-setup)
;;
;; In your .org file, set FILETAGS and, optionally, enable attachments:
;;   #+FILETAGS: :tag1:tag2:tag3:
;;   #+PUBSTATIC_ATTACHMENTS: copy
;;
;; The resulting HTML will contain:
;;   <meta name="keywords" content="tag1, tag2, tag3" />

;;; Code:

(require 'ox)
(require 'org-element)
(require 'url-util)

(defgroup pubstatic-ox nil
  "Org export support for Pubstatic."
  :group 'org-export)

(defcustom pubstatic-attachments-directory nil
  "Pubstatic's public directory.

When this is set and a post contains `#+PUBSTATIC_ATTACHMENTS: copy', local
file links are copied below this directory.  For example, set it to
`/srv/pubstatic/public'."
  :type '(choice (const :tag "Disabled" nil) directory))

(defcustom pubstatic-blog-path (or (getenv "BLOG_PATH") "")
  "Path where Pubstatic is mounted, without a trailing slash.

For a blog mounted at https://blog.example.test/posts, set this to `/posts'."
  :type 'string)

(defvar pubstatic--keywords-to-inject nil
  "String of comma-separated tags to insert as meta keywords.
Set during `org-export-before-processing-hook' and consumed by
the final-output filter.")

(defvar pubstatic--attachments-to-publish nil
  "Local attachments collected from the Org buffer for the current export.")

(defun pubstatic--attachment-mode ()
  "Return the value of the PUBSTATIC_ATTACHMENTS keyword, if any."
  (let ((keyword (cadr (assoc "PUBSTATIC_ATTACHMENTS"
                              (org-collect-keywords '("PUBSTATIC_ATTACHMENTS"))))))
    (and keyword (downcase (string-trim keyword)))))

(defun pubstatic--post-slug ()
  "Return a safe slug based on the Org source filename."
  (replace-regexp-in-string "[^[:alnum:]_-]" "-"
                            (file-name-base (or buffer-file-name "post"))))

(defun pubstatic--url-path (path)
  "URL-encode PATH one component at a time, retaining directory separators."
  (mapconcat #'url-hexify-string (split-string path "/" t) "/"))

(defun pubstatic--image-attachment-p (path)
  "Return non-nil when PATH is an image attachment Org should embed."
  (member (downcase (or (file-name-extension path) ""))
          '("avif" "gif" "jpeg" "jpg" "png" "svg" "webp")))

(defun pubstatic--copy-attachment (source relative-path)
  "Copy SOURCE to the public directory and return its Pubstatic URL.
RELATIVE-PATH is relative to the Org document and is retained below the post
attachment directory when it is safe to do so."
  (let* ((source-dir (file-name-directory (expand-file-name buffer-file-name)))
         (relative (file-relative-name source source-dir))
         ;; Do not let a link outside the Org document's directory escape the
         ;; post's attachment directory.  Its hash still avoids collisions.
         (safe-relative (if (string-prefix-p "../" relative)
                            (concat "external/"
                                    (substring (secure-hash 'sha256 source) 0 12)
                                    "-" (file-name-nondirectory source))
                          relative))
         (destination (expand-file-name
                       (concat "uploads/" (pubstatic--post-slug) "/" safe-relative)
                       pubstatic-attachments-directory))
         (blog-path (replace-regexp-in-string "/+\\'" "" pubstatic-blog-path)))
    (make-directory (file-name-directory destination) t)
    (copy-file source destination t)
    (concat blog-path "/static/uploads/" (pubstatic--post-slug) "/"
            (pubstatic--url-path safe-relative))))

(defun pubstatic-org-collect-attachments (_backend)
  "Collect opted-in local file links from the current Org buffer."
  (setq pubstatic--attachments-to-publish nil)
  (when (string= (pubstatic--attachment-mode) "copy")
    (unless pubstatic-attachments-directory
      (user-error "Set pubstatic-attachments-directory before copying attachments"))
    (unless buffer-file-name
      (user-error "Save the Org file before exporting attachments"))
    (org-element-map (org-element-parse-buffer) 'link
      (lambda (link)
        (when (string= (org-element-property :type link) "file")
          (let* ((path (org-element-property :path link))
                 (source (expand-file-name path (file-name-directory buffer-file-name))))
            (unless (file-regular-p source)
              (user-error "Pubstatic attachment is not a regular file: %s" source))
            (push (cons path (pubstatic--copy-attachment source path))
                  pubstatic--attachments-to-publish)))))))

(defun pubstatic-org-setup-keywords (_backend)
  "Read FILETAGS from the Org buffer and prepare meta keywords injection."
  (setq pubstatic--keywords-to-inject nil)
  (let ((filetags (org-collect-keywords '("FILETAGS"))))
    (when filetags
      (let* ((raw (cadr (assoc "FILETAGS" filetags)))
             (tags (seq-remove
                    (lambda (s) (string-empty-p s))
                    (split-string (string-trim raw ":" ":") ":" t " "))))
        (when tags
          (setq pubstatic--keywords-to-inject
                (mapconcat #'identity tags ", ")))))))

(defun pubstatic-org-rewrite-attachments (output backend _info)
  "Replace copied local attachment URLs in HTML OUTPUT."
  (if (and (org-export-derived-backend-p backend 'html)
           pubstatic--attachments-to-publish)
      (dolist (attachment pubstatic--attachments-to-publish output)
        ;; Org turns an image link with a description into an <a>, while a
        ;; bare image link becomes an <img>.  Attachments should embed in both
        ;; cases, so promote the former before rewriting ordinary URLs.
        (when (pubstatic--image-attachment-p (car attachment))
          (setq output
                (replace-regexp-in-string
                 (concat "<a href=\\([\"']\\)" (regexp-quote (car attachment))
                         "\\1>[^<]*</a>")
                 (format "<img src=\"%s\" alt=\"%s\" />"
                         (cdr attachment) (file-name-nondirectory (car attachment)))
                 output t nil)))
        (setq output
              (replace-regexp-in-string
               (concat "\\(\\(?:src\\|href\\)=\\)\\([\"']\\)"
                       (regexp-quote (car attachment)) "\\2")
               (concat "\\1\\2" (cdr attachment) "\\2") output t nil)))
    output))

(defun pubstatic-org-html-inject-keywords (output backend _info)
  "Inject <meta name=\"keywords\"> into the HTML <head> based on FILETAGS."
  (when (org-export-derived-backend-p backend 'html)
    (let ((tags-str pubstatic--keywords-to-inject))
      (when tags-str
        (let ((meta (format "<meta name=\"keywords\" content=\"%s\" />\n" tags-str)))
          (if (string-match "<head>\n?" output)
              (replace-match (concat (match-string 0 output) meta) t t output)
            (if (string-match "<head>" output)
                (replace-match (concat "<head>\n" meta) t t output)
              output)))))))

;;;###autoload
(defun pubstatic-ox-setup ()
  "Install pubstatic Org export hooks."
  (interactive)
  (add-hook 'org-export-before-processing-hook #'pubstatic-org-setup-keywords)
  (add-hook 'org-export-before-processing-hook #'pubstatic-org-collect-attachments)
  (add-hook 'org-export-filter-final-output-functions #'pubstatic-org-html-inject-keywords)
  (add-hook 'org-export-filter-final-output-functions #'pubstatic-org-rewrite-attachments))

(provide 'pubstatic-ox)
;;; pubstatic-ox.el ends here
