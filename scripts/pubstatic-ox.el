;;; pubstatic-ox.el --- Org export hooks for pubstatic blog  -*- lexical-binding: t; -*-

;; Inject <meta name="keywords"> into HTML export based on FILETAGS so
;; pubstatic's watcher can extract tags from Org-exported HTML files.

;;; Usage:
;;   (require 'pubstatic-ox)
;;   (add-hook 'org-export-before-processing-hook #'pubstatic-org-setup-keywords)
;;
;; In your .org file, set FILETAGS:
;;   #+FILETAGS: :tag1:tag2:tag3:
;;
;; The resulting HTML will contain:
;;   <meta name="keywords" content="tag1, tag2, tag3" />

;;; Code:

(require 'ox)

(defvar pubstatic--keywords-to-inject nil
  "String of comma-separated tags to insert as meta keywords.
Set during `org-export-before-processing-hook' and consumed by
the final-output filter.")

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
  (add-hook 'org-export-filter-final-output-functions #'pubstatic-org-html-inject-keywords))

(provide 'pubstatic-ox)
;;; pubstatic-ox.el ends here
