package revue_test

import (
	"testing"

	"github.com/benaskins/revue"
)

func TestParsePRURL(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		want    revue.PRRef
		wantErr bool
	}{
		{
			name: "standard PR URL",
			url:  "https://github.com/owner/repo/pull/42",
			want: revue.PRRef{Owner: "owner", Repo: "repo", Number: "42"},
		},
		{
			name: "PR URL with trailing path",
			url:  "https://github.com/owner/repo/pull/42/files",
			want: revue.PRRef{Owner: "owner", Repo: "repo", Number: "42"},
		},
		{
			name:    "not a PR URL",
			url:     "https://github.com/owner/repo/issues/42",
			wantErr: true,
		},
		{
			name:    "empty string",
			url:     "",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := revue.ParsePRURL(tt.url)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}
